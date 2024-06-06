import { exec } from 'child_process';

const autoLoot = () => {
  const lootCommand =
    'xdotool keydown shift mousemove 731 409 click --delay 0 3 mousemove 817 409 click --delay 0 3 mousemove 902 410 click --delay 0 3 mousemove 902 494 click --delay 0 3 mousemove 902 580 click --delay 0 3 mousemove 816 580 click --delay 0 3 mousemove 731 579 click --delay 0 3 mousemove 732 496 click --delay 0 3 mousemove 817 494 click --delay 0 3 keyup shift';
  exec(lootCommand);
};

export default autoLoot;
