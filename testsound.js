import playSound from 'play-sound';
import path from 'path';

const soundFilePath = path.join(__dirname, 'electron', 'sounds', 'enable.wav');

const playTestSound = async () => {
  try {
    // Create a player instance
    const player = playSound();

    // Play the sound
    await player.play(soundFilePath);
    console.log('The wav file started to be played successfully.');
  } catch (error) {
    console.error(`Could not play sound: ${error}`);
  }
};

playTestSound();
