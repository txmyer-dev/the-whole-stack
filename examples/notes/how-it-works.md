# How it works

- The container is a horizontal flex row that scrolls sideways.
- Each column is `position: sticky` with a staggered `left` offset, so scrolled-past columns pin at the edge.
- A scroll listener classifies each column as resting, overlay, or obscured.
- Obscured columns fade their body and show a vertical title.

See also [[Why a stack]] and [[Mobile]].
