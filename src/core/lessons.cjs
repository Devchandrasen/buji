const { randomUUID } = require('node:crypto');

function addLesson(lessons, projectId, text) {
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 360) {
    throw new Error('Enter a reusable correction or preference under 360 characters.');
  }
  const note = text.trim();
  const previous = lessons.find(lesson => lesson.projectId === projectId && lesson.text === note);
  const lesson = previous || { id: randomUUID(), projectId, text: note };
  return [lesson, ...lessons.filter(item => item.id !== lesson.id)].slice(0, 100);
}

function lessonPrompt(lessons, projectId) {
  const project = projectId ? lessons.filter(lesson => lesson.projectId === projectId).slice(0, 2) : [];
  const general = lessons.filter(lesson => lesson.projectId === null).slice(0, 2);
  const selected = [...project, ...general];
  if (!selected.length) return '';
  return '\n\nUser-saved lessons for this work. Apply relevant corrections and preferences when they fit the current request and tool permissions.\n' +
    selected.map(lesson => '- ' + lesson.text).join('\n');
}

module.exports = { addLesson, lessonPrompt };
