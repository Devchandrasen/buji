'use strict';

const code = /```|\b(?:python|javascript|typescript|rust|java|c\+\+|sql|powershell|html|css|json|regex|spreadsheet|excel|repository|codebase|api|bug|debug|refactor|implement|compile|pseudocode|algorithm|script|code|coding|program|unit tests?|test cases?|programming)\b|\b(?:write|create|build|fix|modify|return|define)\b[^.\n]{0,55}\b(?:function|program|app|module|class|file|code)\b|\bdef\s+\w+\s*\(|\bfunction\s+\w+\s*\([^)]*\)\s*\{|\b(?:save|edit|run)\b[^.\n]{0,45}\b(?:file|command|terminal|code)\b|कोड|प्रोग्राम/iu;
const logic = /\b(?:options\s*:|truth[- ]?teller|lies|lying|logic puzzle|truth table|boolean|deduc(?:e|tion)|contradiction|which statement|only one of|in what order|line up|arranged in|shuffle[ds]?|calendar|christmas|today|tomorrow|yesterday|starting point|turn left|turn right|steps? (?:forward|backward|left|right)|temporal)\b|\b(?:true|false)\s*(?:and|or|is|[).])|(?:^|\n)\s*\([A-D]\)\s/iu;
const mathWords = /\b(?:equations?|polynomial|fractions?|percentage|percent|ratio|remainder|modulo|integer|divisor|factorial|multiple of|prime number|integral|derivative|differentiat(?:e|ion)|matrix|determinant|logarithm|square root|area|perimeter|volume|radius|triangle|quadratic|probability|expected value|median|mean|arithmetic|geometric sequence|number of ways|sum of|product of|least common|greatest common|slope|coordinates|intersection|simplest form|algebra|calculus|trigonometry)\b|समीकरण|भिन्न|प्रतिशत|क्षेत्रफल|जोड़|गुणा|गणना/iu;
const mathRequest = /\b(?:solve|calculate|compute|simplify|evaluate|determine|find|what is|what are|how many|how much|how large|work out|factorize|factorise|differentiate|integrate|expand|prove|show that|express|round|convert|add|subtract|multiply|divide|kitna|kitni|kitne|nikal(?:o|na)|jodo|ghatao|guna|bhaag|hisab)\b|(?:हल|निकाल|गिन|बताओ|कितना|कितने|कितनी|गणना)/iu;
const notation = /\\(?:frac|dfrac|sqrt|times|cdot|div|int|sum|log|sin|cos|tan|binom|pmod|pi|angle|overline)\b|\$[^$\n]+\$|(?:\d|\b[xyz])\s*(?:[+*/^×÷−]|=(?!=)|-(?=\s*\d))\s*(?:\d|[xyz(])|\d\s*%/iu;
const expression = /^\s*[+−-]?[\d.(][\d\s.,()]*\s*(?:[+*/^×÷−-]\s*[+−-]?[\d.(][\d\s.,()]*)+\s*(?:=\s*)?\??\s*$/u;

function route(messages, toolChoice) {
  if (toolChoice === 'required' || (toolChoice && typeof toolChoice === 'object')) {
    return { name: 'original', reason: 'tool-required' };
  }
  const index = messages.findLastIndex(message => message?.role === 'user');
  if (index < 0 || messages.slice(index + 1).some(message => message?.role === 'tool' || message?.tool_calls?.length)) {
    return { name: 'original', reason: 'tool-followup-or-no-user' };
  }
  const content = messages[index].content;
  if (typeof content !== 'string' && (!Array.isArray(content) || content.some(part => part?.type !== 'text'))) {
    return { name: 'original', reason: 'non-text' };
  }
  const prompt = (typeof content === 'string' ? content : content.map(part => part.text || '').join('\n')).normalize('NFKC');
  if (/\nAttached file [^\r\n]+:\r?\n/i.test(prompt) || code.test(prompt)) {
    return { name: 'original', reason: 'code-or-file-work' };
  }
  if (logic.test(prompt)) return { name: 'original', reason: 'reasoning-cue' };
  if (/^\s*\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\s*\??\s*$/.test(prompt)) {
    return { name: 'original', reason: 'ambiguous-date-or-expression' };
  }
  if (expression.test(prompt) || (mathRequest.test(prompt) && (notation.test(prompt) || mathWords.test(prompt))) ||
      (mathRequest.test(prompt) && /\d/.test(prompt) && /(?:kitna|kitni|kitne|nikalo|jodo|ghatao|guna|bhaag|hisab|कितना|कितने|गणना)/iu.test(prompt))) {
    return { name: 'math-wsp', reason: 'math-request' };
  }
  return { name: 'original', reason: 'default' };
}

module.exports = { route };
