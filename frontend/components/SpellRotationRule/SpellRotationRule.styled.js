import styled from 'styled-components';

const StyledSpellRotationRule = styled.div`
  display: flex;
  flex-direction: column; // Stack rules vertically
  padding: 12px 10px;     // Add some vertical padding
  border-bottom: 1px solid #3a3a3a; // Darker border between rules
  background-color: #2c2c2c; // Slightly different dark grey maybe?
  background-image: none;
  position: relative; // Needed for absolute positioning of the overlay
  overflow: hidden; // Prevent rotated text from spilling out visually if needed

  &:last-child {
    border-bottom: none; // No border for the last rule in the list
  }

  // --- Styles for the Coming Soon Overlay ---
  .coming-soon-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(40, 40, 40, 0.85); // Darker, more opaque overlay
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10; // Ensure overlay is on top
    pointer-events: auto; // Block clicks to underlying elements
    cursor: not-allowed; // Indicate non-interactivity

    span {
      color: rgba(180, 180, 180, 0.7); // Slightly muted text color
      font-size: 2.8em; // Larger font size
      font-weight: bold;
      text-align: center;
      transform: rotate(-30deg); // Diagonal rotation
      border: 3px dashed rgba(100, 100, 100, 0.5); // Optional dashed border
      padding: 15px 30px; // Padding around text
      user-select: none; // Prevent text selection
      white-space: nowrap; // Keep "Coming Soon" on one line
    }
  }
  // --- End Overlay Styles ---

  .rule-controls-top {
    display: flex;
    align-items: center;
    gap: 10px; // Adjust gap
    margin-bottom: 12px;
    // Apply reduced opacity to controls when overlay is active (optional visual cue)
    // opacity: 0.5; // Apply this if you want controls visible but faded
  }

  .control-group { // Group checkbox and label
      display: flex;
      align-items: center;
      gap: 5px;
      label {
          font-size: 11px;
          color: #ccc;
          cursor: pointer;
          user-select: none;
      }
      &.repeat-toggle-group { // Push repeat to the right
          margin-left: auto;
      }
  }

  .rule-name-input {
    min-width: 120px;
    max-width: 200px; // Set max width
    flex-grow: 1; // Allow name input to take available space
    background-color: #333; // Darker input background
    border: 1px solid #555;
    color: #eee;
    padding: 4px 6px;
    font-size: 12px;
     border-radius: 3px;
  }

  .rule-col-sequence {
     display: flex;
     flex-direction: column;
     gap: 6px; // Space between sequence steps
     margin-bottom: 10px; // Space below sequence steps

    .sequence-step {
      display: flex;
      align-items: center;
      gap: 8px; // Keep consistent gap
      font-size: 12px;
      color: #ddd;

       .step-number {
         color: #888;
         min-width: 18px;
         text-align: right;
         font-size: 11px;
       }

       .key-select {
         width: 70px; // Slightly wider key select
         background-color: #333;
         border: 1px solid #555;
         color: #eee;
          padding: 3px 5px;
           border-radius: 3px;
           font-size: 11px;
       }

      .delay-input {
        width: 75px; // Wider delay input
         background-color: #333;
         border: 1px solid #555;
         color: #eee;
          padding: 4px 6px;
           border-radius: 3px;
           font-size: 11px;
      }

       .step-text {
           font-size: 11px;
           color: #aaa;
       }

       // Styles for the left-click checkbox group
       .left-click-group {
           display: flex;
           align-items: center;
           gap: 4px; // Gap between checkbox and label
           margin-left: 5px; // Add space before it

           label {
               font-size: 10px; // Smaller label
               color: #bbb;
               cursor: pointer;
               user-select: none;
               white-space: nowrap; // Prevent wrapping
           }
       }

        .remove-step-button {
            margin-left: auto; // Ensure remove stays pushed right
        }
    }
  }

  .rule-actions-bottom {
      display: flex;
      justify-content: space-between; // Align Add Step and Remove Rule
      align-items: center;
  }

  // Styles for the new hotkey group
  .hotkey-group {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: 15px; // Add some space before hotkey

      span { // Style the '+' sign
          color: #888;
          font-size: 14px;
          margin: 0 2px;
      }

      .modifier-key-select, .activation-key-select {
          width: 70px; // Adjust width as needed
          background-color: #333;
          border: 1px solid #555;
          color: #eee;
          padding: 3px 5px;
          border-radius: 3px;
          font-size: 11px;
      }
  }

  // Common button styles (ensure consistency with other rules)
  .rule-button {
      background: #404040; // Slightly lighter grey for buttons
      border: 1px solid #5a5a5a;
      color: #ccc;
      cursor: pointer;
      border-radius: 3px;
      padding: 3px 8px;
      font-size: 11px;
       display: inline-flex;
       align-items: center;
       justify-content: center;
       line-height: 1;
       min-height: 22px; // Ensure consistent button height


      &:hover {
         border-color: #888;
         background-color: #484848;
         color: #fff;
      }

      &.remove-step-button, &.remove-rule-button {
          background-color: #5a2d2d; // Darker red tone
          border-color: #7a3d3d;
          color: #f0b0b0;
          padding: 0; // Reset padding for icon-like buttons
           width: 22px; // Make square
           height: 22px;
           font-size: 14px; // Adjust icon size

          &:hover {
              background-color: #7a3d3d;
              border-color: #9a4d4d;
              color: #fff;
          }
           &:disabled {
            background-color: #444 !important;
             border-color: #555 !important;
            color: #888 !important;
            cursor: not-allowed;
            opacity: 0.6;
         }
      }
       &.add-step-button {
            background-color: #2d5a2d; // Darker green tone
             border-color: #3d7a3d;
             color: #b0f0b0;
             &:hover {
                background-color: #3d7a3d;
                border-color: #4d9a4d;
                 color: #fff;
            }
       }

       // Specific style for the TEXT remove button
       &.remove-rule-button-text {
           background-color: #5a2d2d; // Use remove colors
           border-color: #7a3d3d;
           color: #f0b0b0;
           padding: 3px 10px; // Add horizontal padding for text
           font-size: 11px;
           width: auto; // Allow width to fit text
           height: 24px; // Match other buttons if needed

           &:hover {
               background-color: #7a3d3d;
               border-color: #9a4d4d;
               color: #fff;
           }
       }
  }
`;

export default StyledSpellRotationRule; 