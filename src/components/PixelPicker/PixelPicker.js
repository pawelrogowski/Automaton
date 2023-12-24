import React from 'react';
import useColorPicker from '../../hooks/useColorPicker.js';

const PixelPicker = () => {
  const { isPicking, color, startPicking, stopPicking } = useColorPicker();

  return (
    <div>
      <button type="button" onClick={isPicking ? stopPicking : startPicking}>
        {isPicking ? 'Stop picking' : 'Start picking'}
      </button>
      {color && <div>Picked color: {color}</div>}
    </div>
  );
};

export default PixelPicker;
