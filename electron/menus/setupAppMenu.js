import { Menu } from 'electron';
import { selectWindow } from './windowSelection.js';

const setupAppMenu = () => {
  const template = [
    {
      label: 'Select Window',
      click: () => {
        setTimeout(() => {
          selectWindow();
        }, 75);
      },
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

export default setupAppMenu;
