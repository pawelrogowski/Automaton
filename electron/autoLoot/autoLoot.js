import { exec } from 'child_process';

const autoLoot = () => {
  const lootCommand =
    'xdotool keydown shift mousemove 734 414 click --delay 0 3 mousemove 821 418 click --delay 0 3 mousemove 902 413 click --delay 0 3 mousemove 902 497 click --delay 0 3 mousemove 900 581 click --delay 0 3 mousemove 820 580 click --delay 0 3 mousemove 737 584 click --delay 0 3 mousemove 737 494 click --delay 0 3 mousemove 818 498 click --delay 0 3 keyup shift';
  exec(lootCommand);
};

export default autoLoot;
