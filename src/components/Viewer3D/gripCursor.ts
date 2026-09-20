/**
 * The desktop pointer over a drag grip. One place, because it is a global.
 *
 * `document.body` belongs to nobody in particular, and the React compiler is
 * right to refuse a write to it from inside a component body — a component that
 * mutates the page outside its own tree cannot be re-ordered or re-run safely.
 * Behind a named function in a plain module it is what it actually is: an
 * imperative effect on the document, called deliberately.
 *
 * Desktop only, by nature — there is no hover on a phone, so the grip meshes
 * are sized to be grabbed with a fingertip and this is the extra the mouse gets.
 */
export function setGripCursor(grabbing: boolean): void {
  document.body.style.cursor = grabbing ? 'move' : ''
}
