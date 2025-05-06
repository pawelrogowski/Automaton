// Create file: frontend/components/CustomIconSelect/CustomIconSelect.styled.js
import styled from 'styled-components';

const ROW_HEIGHT = '38px'; // Define a variable for the new row height (32px icon + padding)
const ICON_SIZE = '32px'; // Define icon size variable

export const SelectWrapper = styled.div`
  position: relative;
  width: 100%; /* Make wrapper fill its container */
  height: ${ROW_HEIGHT}; // Use variable
  font-size: 11px;
  color: #d3d3d3;
`;

export const SelectTrigger = styled.button`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%; /* Ensure trigger fills the wrapper */
  height: 100%;
  padding: 0 ;
  background: #414141;
  border-top: 1px solid #16181d;
  border-left: 1px solid #79797930;
  border-bottom: 1px solid #79797930;
  border-right: 1px solid #16181d;
  cursor: pointer;
  outline: none;
  text-align: left; /* Ensure text aligns left */
  overflow: hidden; /* Hide overflow */
  white-space: nowrap; /* Prevent wrapping */

  background-image: none !important;
  &::before, &::after { content: none !important; display: none !important; }

  &:hover {
    filter: brightness(1.1);
  }

  &:focus { /* Optional focus */ }

  /* Styles for the icon inside the trigger */
  .trigger-icon {
    width: ${ICON_SIZE}; // Use variable
    height: ${ICON_SIZE}; // Use variable
    margin-right: 6px;
    object-fit: contain;
    flex-shrink: 0;
  }

  /* Styles for the text label inside the trigger */
  .trigger-label {
    flex-grow: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11px;
    color: #d3d3d3;
  }
`;

export const OptionsList = styled.ul`
  position: absolute; /* ADDED BACK - Needed for dropdown behavior */
  top: 100%; /* ADDED BACK - Position below the trigger */
  left: 0; /* ADDED BACK - Align with the trigger's left edge */
  width: max-content;
  /* min-width: 180px; */ /* Consider adding a min-width if needed */
  max-height: 300px;
  overflow-y: auto;
  overflow-x: hidden;
  background: #363636;
  border: 1px solid #797979;
  list-style: none;
  padding: 0;
  margin: 0;
  z-index: 1000; // Keep high z-index
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);

  /* display: ${props => props.$isOpen ? 'block' : 'none'}; */ /* This logic is handled by conditional rendering in the component */
`;

// Wrapper for the search input - NEEDS EXPORT
export const SearchInputWrapper = styled.div`
   padding: 4px 8px; /* Padding around the input */
   background-color: #414141;
   border-bottom: 1px solid #555;
   position: sticky;
   top: 0;
   z-index: 1;
   box-sizing: border-box; /* Ensure padding doesn't affect outer dimensions */
`;

// Style for the search input itself - NEEDS EXPORT
export const SearchInput = styled.input`
   display: block; /* Ensure it behaves like a block element */
   width: 100%; /* Take full width of the parent wrapper */
   padding: 4px 6px;
   font-size: 11px;
   line-height: 1;
   color: #d3d3d3;
   background-color: #505050 !important; /* FORCED background color */
   border: 1px solid #797979;
   border-radius: 2px;
   outline: none !important; /* FORCED outline removal */
   box-sizing: border-box; /* Crucial for width: 100% */

   /* Override default browser styles if necessary */
   appearance: none;
   -webkit-appearance: none;

   &:focus {
     border-color: #a0a0a0; /* Keep border focus color */
     outline: none !important; /* Ensure outline stays removed on focus */
   }

   /* Placeholder text color */
   &::placeholder {
     color: #a0a0a0;
     opacity: 1; /* Firefox */
   }
   &::-ms-input-placeholder { /* Edge <= 18 */
     color: #a0a0a0;
   }
`;

export const OptionItem = styled.li`
  display: flex;
  align-items: center;
  /* Adjust padding for taller items */
  padding: 3px 12px; /* Reduced vertical padding slightly */
  /* Set min-height to accommodate icon + padding */
  min-height: ${ROW_HEIGHT};
  cursor: pointer;
  white-space: nowrap;
  outline: none; /* Remove potential focus outline if managing manually */

  &:hover, &.active { /* Style both hover and keyboard active state */
    background-color: #555;
    color: #fff; /* Example: change text color too */

     /* Ensure child span also inherits color if needed */
     span {
       color: #fff;
     }
  }

  /* &.active { // If you want a distinct style only for keyboard focus
      border: 1px dotted yellow; // Example
  } */

  img {
    width: ${ICON_SIZE}; // Use variable
    height: ${ICON_SIZE}; // Use variable
    margin-right: 8px;
    object-fit: contain;
    flex-shrink: 0; // Prevent shrinking
  }

  span {
    font-size: 11px;
    color: #d3d3d3; /* Default color */
  }

  &.no-results {
     justify-content: center;
     color: #a0a0a0;
     cursor: default;
     &:hover, &.active {
       background-color: transparent; /* No hover/active effect */
     }
  }
`;

export const CategoryHeader = styled.li`
  padding: 4px 12px;
  font-weight: bold;
  color: #a0a0a0;
  font-size: 10px;
  text-transform: uppercase;
  border-bottom: 1px solid #555;
  margin: 2px 0; // Adjust margin if needed
  cursor: default; /* Not clickable */
  background-color: #363636; /* Ensure background matches list */
`;