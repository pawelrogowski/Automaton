/**
 * Recursively finds a window by its ID. If the window is not found, it falls back to the root window.
 *
 * @param {Object} X - The X11 client object.
 * @param {number} windowId - The ID of the window to find.
 * @param {number} targetId - The ID of the target window.
 * @param {Function} callback - The callback function to call when the window is found.
 */
const findWindowById = (X, windowId, targetId, callback) => {
  X.QueryTree(windowId, (err, tree) => {
    if (err) {
      console.error('Error querying tree:', err);
      return;
    }

    if (windowId === targetId) {
      callback(windowId);
      return;
    }

    if (tree.children.length === 0) {
      console.warn('Window not found, falling back to root window.');
      callback(windowId);
      return;
    }

    tree.children.forEach((childWindowId) => {
      findWindowById(X, childWindowId, targetId, callback);
    });
  });
};

export default findWindowById;
