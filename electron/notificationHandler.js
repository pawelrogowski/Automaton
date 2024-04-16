// notificationHandler.js
import { Notification, nativeImage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

// Convert import.meta.url to a file path
const __filenamePath = fileURLToPath(import.meta.url);
// Get the directory name
const __dirnamePath = path.dirname(__filenamePath);

// Hardcode the icon path using the adjusted path resolution
const iconPath = path.join(__dirnamePath, 'icons', 'skull.png');

const createIconImage = () => {
  try {
    return nativeImage.createFromPath(iconPath);
  } catch (error) {
    console.error('Error creating icon image:', error);
    return null; // Return null or a default icon if the image cannot be loaded
  }
};

export const showNotification = (title, body) => {
  try {
    new Notification({
      title: title,
      body: body,
      icon: createIconImage(),
    }).show();
  } catch (error) {
    console.error('Error showing notification:', error);
  }
};
