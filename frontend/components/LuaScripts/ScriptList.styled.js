// /home/orimorfus/Documents/Automaton/frontend/components/LuaScripts/ScriptList.styled.js
import styled from 'styled-components';

const StyledList = styled.div`
  color: #fafafa;

  h3 {
    margin-top: 0;
    margin-bottom: 10px;
  }

  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  li {
    background-color: #2b2b2b; /* Darker background for list items */
    border: 1px solid #444;
    margin-bottom: 8px;
    padding: 10px;
    border-radius: 4px;
    display: flex;
    flex-direction: column; /* Change to column to stack content and log */
    justify-content: space-between;
    align-items: flex-start; /* Align items to the start */

    &:hover {
        background-color: #3b3b3b; /* Slightly lighter background on hover */
    }
  }

   li > div { /* Style for the wrapper div around name and buttons */
        display: flex;
        justify-content: space-between;
        align-items: center;
        width: 100%; /* Take full width */
   }


  span {
    flex-grow: 1;
    margin-right: 10px;
    overflow: hidden; /* Hide overflow text */
    text-overflow: ellipsis; /* Add ellipsis for truncated text */
    white-space: nowrap; /* Prevent wrapping */
  }

  button {
      background-color: #555;
      color: white;
      border: none;
      padding: 5px 10px;
      margin-left: 5px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;

      &:hover {
          background-color: #666;
      }

      &:active {
          background-color: #444;
      }
  }

   /* Style for the log display area */
    .script-log-display {
        width: calc(100% - 20px); /* Take full width minus padding */
        max-height: 100px; /* Limit height and add scroll */
        overflow-y: auto;
        background-color: #1e1e1e;
        border: 1px solid #444;
        margin-top: 10px; /* Space above the log */
        padding: 5px;
        font-size: 10px; /* Smaller font for logs */
        color: #bbb; /* Lighter color for log text */
        white-space: pre-wrap;
        word-wrap: break-word;
    }
`;

export default StyledList;