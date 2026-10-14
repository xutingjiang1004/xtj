'use strict';

// CommonMark fences close only with the same character, at least as many
// markers, and no trailing info string. A shorter fence can be literal code.
function nextFence(line, fence) {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(String(line).replace(/\r$/, ''));
  if (!match) return fence;
  const markers = match[1], tail = match[2];
  if (fence) return markers[0] === fence.marker && markers.length >= fence.length && !tail.trim() ? null : fence;
  if (markers[0] === '`' && tail.includes('`')) return null;
  return {marker: markers[0], length: markers.length};
}
function insideFence(text) {
  let fence = null;
  for (const line of String(text).split('\n')) fence = nextFence(line, fence);
  return !!fence;
}
module.exports = {nextFence, insideFence};
