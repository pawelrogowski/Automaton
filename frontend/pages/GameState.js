import React from 'react';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom'; // Import useLocation
import StyledGameState from './GameState.styled.js';
import HighWrapper from '../components/HighWrapper/HighWrapper.js';
import { JsonViewer } from '@textea/json-viewer'; // Import the JsonViewer component

const GameState = () => {
  const location = useLocation();
  const hash = location.hash;

  // Determine which state slice to display based on the hash
  const stateToDisplay = useSelector((state) => {
    switch (hash) {
      case '#globalState':
        return state.global;
      case '#rules':
        return state.rules;
      case '#gameState':
      default:
        return state.gameState; // Default to gameState if hash is not recognized or empty
      case '#luaState': // Add case for luaState
        return state.lua; // Return lua state slice
      case '#cavebotState':
        return state.cavebot;
      case '#statusMessagesState':
        return state.statusMessages;
      case '#regionCoordinatesState':
        return state.regionCoordinates;
    }
  });

  // Determine the title for the HighWrapper and JsonViewer based on the hash
  const title = () => {
    switch (hash) {
      case '#globalState':
        return 'Global State';
      case '#rules':
        return 'Rule State (Healing)';
      case '#gameState':
      default:
        return 'Game State';
      case '#luaState': // Add case for luaState
        return 'Lua Scripts'; // Return lua state slice
      case '#cavebotState':
        return 'Cavebot State';
      case '#statusMessagesState':
        return 'Status Messages';
      case '#regionCoordinatesState':
        return 'Region Coordinates';
    }
  };

  return (
    <StyledGameState>
      <HighWrapper title={title()}>
        <JsonViewer
          className="Json"
          rootName={title()} // Use the determined title as the root name
          value={stateToDisplay} // Pass the selected state slice
          theme="dark" // Use a dark theme for better visibility
          defaultInspectDepth={1} // Set default depth to 1 to collapse nested objects
          quotesOnKeys={false} // Do not display quotes around keys
          displayDataTypes={false} // Do not display data types
          displayComma={false} // Do not display commas
          // You can add other props here to customize the appearance and behavior
          // e.g., enableClipboard={true}, showToolbar={true}
        />
      </HighWrapper>
    </StyledGameState>
  );
};

export default GameState;
