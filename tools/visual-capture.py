"""Window-only Windows Graphics Capture. JSONL stdin/stdout; no network or files."""
import asyncio
import base64
import ctypes
from ctypes import wintypes
import io
import json
import sys
import time
import uuid

from PIL import Image, ImageChops, ImageStat
from winrt.windows.graphics.capture import Direct3D11CaptureFramePool, GraphicsCaptureSession
from winrt.windows.graphics.capture.interop import create_for_window
from winrt.windows.graphics.directx import DirectXPixelFormat
from winrt.windows.graphics.directx.direct3d11.interop import create_direct3d11_device
from winrt.windows.graphics.imaging import SoftwareBitmap, BitmapPixelFormat, BitmapAlphaMode
from winrt.windows.storage.streams import Buffer

user32 = ctypes.WinDLL('user32', use_last_error=True)
dwm = ctypes.WinDLL('dwmapi')
user32.IsWindow.argtypes = [wintypes.HWND]
user32.IsIconic.argtypes = [wintypes.HWND]
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.SetThreadDpiAwarenessContext.argtypes = [ctypes.c_void_p]
user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))
dwm.DwmGetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD]
device = None
latest = None


def geometry(window):
    hwnd = int(window['id'])
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if not user32.IsWindow(hwnd) or pid.value != window['pid'] or user32.IsIconic(hwnd):
        raise ValueError('Selected app is closed, minimized or changed. Restore it and observe again.')
    rect = wintypes.RECT()
    if dwm.DwmGetWindowAttribute(hwnd, 9, ctypes.byref(rect), ctypes.sizeof(rect)) != 0:
        raise ValueError('Window geometry unavailable.')
    width, height = rect.right - rect.left, rect.bottom - rect.top
    if width < 80 or height < 80 or width > 7680 or height > 4320:
        raise ValueError('Unsupported window size.')
    return {'left': rect.left, 'top': rect.top, 'width': width, 'height': height}


async def capture(window):
    global device
    before = geometry(window)
    if not GraphicsCaptureSession.is_supported():
        raise ValueError('Windows Graphics Capture is unavailable on this Windows session.')
    if device is None:
        device = create_direct3d11_device()
    item = create_for_window(int(window['id']))
    pool = Direct3D11CaptureFramePool.create_free_threaded(device, DirectXPixelFormat.B8_G8_R8_A8_UINT_NORMALIZED, 2, item.size)
    session = pool.create_capture_session(item)
    session.is_cursor_capture_enabled = False
    frame = bitmap = converted = None
    try:
        session.start_capture()
        await asyncio.sleep(.35)
        deadline = time.monotonic() + 5
        while frame is None and time.monotonic() < deadline:
            frame = pool.try_get_next_frame()
            if frame is None:
                await asyncio.sleep(.02)
        if frame is None:
            raise ValueError('No window frame arrived. Restore the app and try again.')
        settle = time.monotonic() + .25
        while time.monotonic() < settle:
            newer = pool.try_get_next_frame()
            if newer is not None:
                frame.close()
                frame = newer
            await asyncio.sleep(.025)
        width, height = frame.content_size.width, frame.content_size.height
        if abs(width - before['width']) > 2 or abs(height - before['height']) > 2:
            raise ValueError('Capture geometry does not match the app. Observe again after resizing.')
        bitmap = await SoftwareBitmap.create_copy_from_surface_async(frame.surface)
        converted = SoftwareBitmap.convert(bitmap, BitmapPixelFormat.BGRA8, BitmapAlphaMode.IGNORE)
        buffer = Buffer(converted.pixel_width * converted.pixel_height * 4)
        buffer.length = buffer.capacity
        converted.copy_to_buffer(buffer)
        image = Image.frombytes('RGB', (converted.pixel_width, converted.pixel_height), bytes(buffer), 'raw', 'BGRX')
        image = image.crop((0, 0, width, height))
        if geometry(window) != before:
            raise ValueError('The window moved during capture. Observe again.')
        body = image.crop((min(20,width//10), min(65, height // 8), width-min(20,width//10), height-min(20,height//10)))
        if max(ImageStat.Stat(body.resize((64, 64))).stddev) < 2:
            raise ValueError('This app returned a blank/protected capture. Continue manually.')
        image.thumbnail((1280, 900), Image.Resampling.LANCZOS)
        return image, before
    finally:
        if converted: converted.close()
        if bitmap: bitmap.close()
        if frame: frame.close()
        session.close()
        pool.close()


async def request(data):
    global latest
    if data['action'] == 'capture':
        image, rect = await capture(data['window'])
        encoded = io.BytesIO()
        image.save(encoded, format='JPEG', quality=90)
        snapshot = str(uuid.uuid4())
        latest = {'snapshot': snapshot, 'window': data['window'], 'rect': rect, 'image': image, 'at': time.monotonic()}
        return {'snapshot': snapshot, 'rect': rect, 'width': image.width, 'height': image.height,
                'image': 'data:image/jpeg;base64,' + base64.b64encode(encoded.getvalue()).decode('ascii'), 'capture': 'Windows Graphics Capture'}
    if data['action'] == 'verify':
        if not latest or data['snapshot'] != latest['snapshot'] or time.monotonic() - latest['at'] > 240:
            raise ValueError('Stale visual snapshot. Observe again.')
        image, rect = await capture(latest['window'])
        if rect != latest['rect'] or image.size != latest['image'].size:
            raise ValueError('The app moved or resized after review. Observe again.')
        difference = ImageChops.difference(image, latest['image'])
        if sum(ImageStat.Stat(difference.resize((96, 64))).mean) / 3 > 10:
            raise ValueError('The screen changed after observation. Observe again before acting.')
        if 'x' in data and 'y' in data:
            x, y = round(data['x'] * (image.width - 1) / 1000), round(data['y'] * (image.height - 1) / 1000)
            patch = difference.crop((max(0, x - 35), max(0, y - 25), min(image.width, x + 35), min(image.height, y + 25)))
            if sum(ImageStat.Stat(patch).mean) / 3 > 15:
                raise ValueError('The target changed after observation. Observe again.')
        latest = None
        return {'verified': True, 'rect': rect}
    if data['action'] == 'forget':
        latest = None
        return {'forgotten': True}
    raise ValueError('Unsupported capture request.')


for line in sys.stdin:
    data = {}
    try:
        if len(line) > 16000: raise ValueError('Request too large.')
        data = json.loads(line)
        result = asyncio.run(request(data))
        reply = {'id': data['id'], 'result': result}
    except Exception as error:
        reply = {'id': data.get('id'), 'error': str(error)}
    print(json.dumps(reply, ensure_ascii=True), flush=True)
