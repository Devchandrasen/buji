'use strict';
// Exact, bounded arithmetic for unambiguous numeric requests. No eval, code execution or network.
const number='([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))';
function gcd(a,b){a=a<0n?-a:a;while(b){[a,b]=[b,a%b];}return a;}
function reduce(n,d){if(!d)return null;if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return[n/g,d/g];}
function decimal(value){if(value.replace(/[^0-9]/g,'').length>18)return null;const [whole,part='']=value.split('.');return reduce(BigInt((whole||'0')+part),10n**BigInt(part.length));}
function format([n,d]){
  if(d===1n)return String(n);let remainder=d,a=0,b=0;while(remainder%2n===0n){a++;remainder/=2n;}while(remainder%5n===0n){b++;remainder/=5n;}
  if(remainder!==1n)return n+'/'+d;const digits=Math.max(a,b);if(digits>200)return null;
  const negative=n<0n;let value=String((negative?-n:n)*10n**BigInt(digits)/d).padStart(digits+1,'0');
  value=value.slice(0,-digits)+'.'+value.slice(-digits);value=value.replace(/0+$/,'').replace(/\.$/,'');return(negative?'-':'')+value;
}
function arithmetic(prompt){
  if(typeof prompt!=='string'||prompt.length>300)return null;
  const normalized=prompt.normalize('NFKC').replace(/[०-९]/g,c=>String(c.charCodeAt(0)-0x966)).replace(/।/g,'.');
  const match=normalized.match(/^([\s\S]*?)(?:[.!?]\s*|\s+)(?:(?:reply|respond|answer)\s+(?:with\s+)?(?:only|just)\s+(?:the\s+)?(?:number|answer)|sirf\s+(?:number|answer)\s+(?:do|batao)|केवल\s+(?:संख्या|उत्तर)\s*(?:दो|बताओ|बताइए)?)[.!?\s]*$/iu);
  const core=(match?match[1]:normalized).trim();
  const explicit=/^(?:please\s+)?(?:calculate|compute|evaluate|what is|find)\s+/iu.test(core);
  const expression=core.replace(/^(?:please\s+)?(?:calculate|compute|evaluate|what is|find)\s+/iu,'').replace(/[?.!]\s*$/u,'').trim();
  if(!match&&!explicit&&/^0?\d\/0?\d\d?$/.test(expression))return null;
  let left,right,op,percent=false;
  let parts=expression.match(new RegExp('^'+number+'\\s*(?:ka|का|के)\\s*'+number+'\\s*(?:percent|प्रतिशत|फीसदी|%)\\s*(?:(?:kitna|kitni|kitne)(?:\\s+hai)?|कितना(?:\\s+है)?|निकालो|batao)?\\s*$','iu'));
  if(parts){left=decimal(parts[1]);right=decimal(parts[2]);percent=true;}
  else {
    parts=expression.match(new RegExp('^'+number+'\\s*(?:percent|%)\\s+of\\s+'+number+'$','iu'));
    if(parts){left=decimal(parts[2]);right=decimal(parts[1]);percent=true;}
    else {parts=expression.match(new RegExp('^'+number+'\\s*([+*/×÷−-])\\s*'+number+'$','u'));if(!parts)return null;left=decimal(parts[1]);op=parts[2];right=decimal(parts[3]);}
  }
  if(!left||!right)return null;const [a,b]=left,[c,d]=right;let result;
  if(percent)result=reduce(a*c,b*d*100n);
  else if(op==='+')result=reduce(a*d+c*b,b*d);
  else if(op==='-'||op==='−')result=reduce(a*d-c*b,b*d);
  else if(op==='*'||op==='×')result=reduce(a*c,b*d);
  else result=reduce(a*d,b*c);
  if(!result)return null;const answer=format(result);return answer&&answer.length<=240?{answer,source:'exact-local-arithmetic',expression}:null;
}
module.exports={arithmetic};
