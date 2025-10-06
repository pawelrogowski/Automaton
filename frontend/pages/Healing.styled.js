import styled from 'styled-components';

const StyledMain = styled.main`
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  min-height: 0; /* Important for flex children */

  .filter-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 24px;
    background-color: rgba(25, 25, 25, 0.5);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    gap: 16px;
    flex-shrink: 0; /* Prevent filter bar from shrinking */
  }

  .filter-buttons {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .filter-button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background-color: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 6px;
    color: #b0b0b0;
    font-size: 13px;
    font-family: sans-serif;
    cursor: pointer;
    transition: all 0.2s ease;

    img {
      width: 24px;
      height: 24px;
      object-fit: contain;
    }

    &:hover {
      background-color: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.25);
      color: #e0e0e0;
    }

    &.active {
      background-color: rgba(80, 120, 200, 0.2);
      border-color: rgba(100, 150, 255, 0.4);
      color: #ffffff;
    }
  }

  .add-rule-button {
    padding: 8px 20px;
    background-color: rgba(80, 180, 80, 0.15);
    border: 1px solid rgba(100, 220, 100, 0.3);
    border-radius: 6px;
    color: #90e090;
    font-size: 13px;
    font-family: sans-serif;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;

    &:hover {
      background-color: rgba(80, 180, 80, 0.25);
      border-color: rgba(100, 220, 100, 0.5);
      color: #b0ffb0;
    }

    &:active {
      transform: scale(0.98);
    }
  }

  .content-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 0;
    min-height: 0; /* Important for flex children */
  }

  /* StatBars should not scroll */
  .content-area > div:first-child {
    flex-shrink: 0;
  }

  .list-bg {
    details,
    select,
    input,
    summary {
      filter: brightness(1.05);
    }
    summary,
    details {
      background: #414141;
      ul {
        background: #414141;
      }
    }
  }
`;
export default StyledMain;
