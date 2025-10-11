import styled from 'styled-components';

export const StyledDiv = styled.div`
  z-index: 1000;
  width: 100vw;
  height: 100vh;
  position: fixed; /* Use fixed for full viewport coverage */
  top: 0;
  left: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  backdrop-filter: blur(8px); /* Subtle blur */
  background-color: rgba(0, 0, 0, 0.5); /* Semi-transparent overlay */

  > div {
    /* Main dialog container */
    position: relative;
    width: 400px; /* Adjusted width */
    height: auto; /* Auto height based on content */
    padding: 20px; /* Increased padding */
    background-color: rgba(255, 255, 255, 0.15); /* Lighter background */
    backdrop-filter: blur(10px); /* Glassmorphic blur */
    border-radius: 15px; /* More rounded corners */
    border: 1px solid rgba(255, 255, 255, 0.2); /* Lighter border */
    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37); /* Add shadow */
    display: flex;
    flex-direction: column;
    gap: 20px; /* Space between title and content */

    > .title-text {
      position: static; /* Removed absolute positioning */
      display: block; /* Use block for natural flow */
      width: 100%;
      height: auto;
      margin: 0;
      padding: 0;
      background: transparent;
      border: none; /* Remove border */
      color: #e0e0e0; /* Lighter color */
      font-size: 18px; /* Increased font size */
      font-weight: bold; /* Bold title */
      text-align: center; /* Center title text */
      line-height: 1.5;
      letter-spacing: 0;
    }

    > div {
      /* Content wrapper */
      width: 100%;
      height: auto; /* Auto height */
      background: transparent;
      padding: 0; /* Remove padding */
      border: none; /* Remove borders */
      display: flex;
      flex-direction: column; /* Ensure column layout */
      gap: 15px; /* Space between content sections */

      > .inner-border-wrapper {
        /* Remove this wrapper or repurpose if needed. Keeping minimal changes for now. */
        /* If removed, adjust padding/margins on content-wrapper directly */
        background: transparent;
        padding: 0; /* Remove padding */
        border: none; /* Remove borders */
        width: 100%;
        height: auto;
        > .content-wrapper {
          display: flex;
          flex-direction: column;
          gap: 15px; /* Space between top and bottom content */

          > .top-content {
            height: auto; /* Auto height */
            border-bottom: none; /* Remove border */
            > p {
              font-size: 14px; /* Increased font size */
              color: #cccccc; /* Lighter color */
              text-align: center; /* Center text */
              margin: 0; /* Remove default margin */
            }
          }
          > .bot-content {
            display: flex;
            width: 100%;
            border-top: none; /* Remove border */
            justify-content: center; /* Center buttons */
            > div {
              /* Button container */
              padding-top: 0; /* Remove padding */
              display: flex;
              flex-direction: row;
              gap: 10px; /* Increased gap */
              height: auto; /* Auto height */
              margin: 0 auto; /* Center the button container */
            }
          }
        }
      }
    }
  }

  .confirm-button {
    /* {{change 1}} */
    background: rgba(255, 255, 255, 0.1); /* Semi-transparent background */
    border: 1px solid rgba(255, 255, 255, 0.3); /* Subtle border */
    border-radius: 8px; /* Rounded corners */
    padding: 8px 16px; /* Increased padding */
    color: #e0e0e0; /* Light text color */
    font-size: 14px; /* Slightly larger font */
    transition: all 0.3s ease; /* Smooth transition */
    backdrop-filter: blur(5px); /* Button specific blur */
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2); /* Subtle shadow */

    display: flex;
    justify-content: center;
    align-items: center;
    min-width: 80px; /* Adjusted min-width */
    text-align: center;

    &:hover {
      background: rgba(255, 255, 255, 0.2); /* Lighter on hover */
      border-color: rgba(255, 255, 255, 0.5);
      cursor: pointer;
    }

    &:active {
      background: rgba(255, 255, 255, 0.1); /* Slightly darker when active */
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.3); /* Inset shadow */
    }
    /* {{end}} */
  }
`;
