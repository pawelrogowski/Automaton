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
    justify-content: space-between;
    align-items: center;
  }

  span {
    flex-grow: 1;
    margin-right: 10px;
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
`;

export default StyledList;
