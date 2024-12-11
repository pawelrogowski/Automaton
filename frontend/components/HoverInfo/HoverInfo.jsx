import React, { useState, useEffect } from 'react';
import { StyledSpan } from './HoverInfo.styled';

const HoverInfo = () => {
  const [tooltipText, setTooltipText] = useState(null);

  useEffect(() => {
    const handleMouseEnter = (e) => {
      // Check if the target element itself has a tooltip attribute
      let tooltip = e.target.getAttribute('tooltip');

      // If not, check the closest parent with the tooltip attribute
      if (!tooltip) {
        const parent = e.target.closest('[tooltip]');
        if (parent) {
          tooltip = parent.getAttribute('tooltip');
        }
      }

      if (tooltip) {
        setTooltipText(tooltip);
      }
    };

    const handleMouseLeave = () => {
      setTooltipText(null);
    };

    // Attach the event listeners globally (to the whole document or a specific container)
    document.body.addEventListener('mouseover', handleMouseEnter);
    document.body.addEventListener('mouseout', handleMouseLeave);

    // Cleanup event listeners on unmount
    return () => {
      document.body.removeEventListener('mouseover', handleMouseEnter);
      document.body.removeEventListener('mouseout', handleMouseLeave);
    };
  }, []);

  return <div>{<StyledSpan>{tooltipText}</StyledSpan>}</div>;
};

export default HoverInfo;
