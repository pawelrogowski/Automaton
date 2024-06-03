import { exec } from 'child_process';

const autoLoot = () => {
  const lootCommand =
    'xdotool keydown shift mousemove 636 437 click --delay 0 3 mousemove 731 440 click --delay 0 3 mousemove 827 440 click --delay 0 3 mousemove 828 536 click --delay 0 3 mousemove 826 632 click --delay 0 3 mousemove 732 632 click --delay 0 3 mousemove 634 628 click --delay 0 3 mousemove 635 534 click --delay 0 3 mousemove 734 538 click --delay 0 3 keyup shift';
  exec(lootCommand);
};

export default autoLoot;
