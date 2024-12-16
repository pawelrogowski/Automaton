import React, { useEffect, useCallback } from 'react';
import { StyledDiv } from './ConfirmDialog.styled';

const ConfirmDialog = ({ title, text, onConfirm, onCancel }) => {
  // Handle keyboard events for Esc and Enter
  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter') {
        onConfirm();
      }
    },
    [onConfirm, onCancel],
  );

  useEffect(() => {
    // Add event listener when component mounts
    document.addEventListener('keydown', handleKeyDown);

    // Cleanup event listener when component unmounts
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  return (
    <StyledDiv>
      <div>
        <span className="title-text">{title}</span>
        <div>
          <div className="inner-border-wrapper">
            <div className="content-wrapper">
              <div className="top-content">
                <p>{text}</p>
              </div>
              <div className="bot-content">
                <div>
                  <button className="confirm-button" onClick={onConfirm}>
                    Ok
                  </button>
                  <button className="confirm-button" onClick={onCancel}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </StyledDiv>
  );
};

export default ConfirmDialog;
