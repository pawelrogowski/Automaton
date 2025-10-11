import styled from 'styled-components';

const ROW_HEIGHT = '38px';
const ICON_SIZE = '32px';

export const SelectWrapper = styled.div`
  position: relative;
  width: 100%;
  height: ${ROW_HEIGHT};
  font-size: 11px;
  color: #d3d3d3;
`;

export const SelectTrigger = styled.button`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  height: 100%;
  padding: 0;
  cursor: pointer;
  outline: none;
  text-align: left;
  overflow: hidden;
  white-space: nowrap;
  user-select: none;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease-in-out;

  padding-left: 4px;
  &:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  /* Styles for the icon inside the trigger */
  .trigger-icon {
    width: ${ICON_SIZE};
    height: ${ICON_SIZE};
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
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 300px;
  overflow-y: auto;
  overflow-x: hidden;

  border: 1px solid rgba(255, 255, 255, 0.2);
  border-top: none;
  border-radius: 0 0 4px 4px;
  background: rgba(44, 44, 44, 0.95);

  list-style: none;
  padding: 0;
  margin: 0;
  z-index: 9999;

  /* Scrollbar styles */
  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 10px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 10px;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.3);
  }
`;

export const SearchInputWrapper = styled.div`
  padding: 4px 8px;
  background-color: rgba(44, 44, 44, 0.95);
  position: sticky;
  top: 0;
  z-index: 1;
  box-sizing: border-box;
`;

export const SearchInput = styled.input`
  display: block;
  width: 100%;
  padding: 4px 6px;
  font-size: 11px;
  line-height: 1;
  color: #d3d3d3;
  background-color: rgba(0, 0, 0, 0.3) !important;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  outline: none !important;
  box-sizing: border-box;

  appearance: none;
  -webkit-appearance: none;

  &:focus {
    border-color: rgba(255, 255, 255, 0.3);
    outline: none !important;
  }

  &::placeholder {
    color: #a0a0a0;
    opacity: 1;
  }
  &::-ms-input-placeholder {
    color: #a0a0a0;
  }
`;

export const OptionItem = styled.li`
  display: flex;
  align-items: center;
  padding: 3px 12px;
  min-height: ${ROW_HEIGHT};
  cursor: pointer;
  white-space: nowrap;
  outline: none;
  transition: background-color 0.1s ease-in-out;
  background-color: transparent; // {{change 2: Ensure default background is transparent}}

  &:hover,
  &.active {
    background-color: rgba(255, 255, 255, 0.1);
    color: #fff;

    span {
      color: #fff;
    }
  }

  img {
    width: ${ICON_SIZE};
    height: ${ICON_SIZE};
    margin-right: 8px;
    object-fit: contain;
    flex-shrink: 0;
  }

  span {
    font-size: 11px;
    color: #d3d3d3;
  }

  &.no-results {
    justify-content: center;
    color: #a0a0a0;
    cursor: default;
    &:hover,
    &.active {
      background-color: transparent;
    }
  }
`;

export const CategoryHeader = styled.li`
  padding: 4px 12px;
  font-weight: bold;
  color: #a0a0a0;
  font-size: 10px;
  text-transform: uppercase;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  margin: 2px 0;
  cursor: default;
  background-color: rgba(44, 44, 44, 0.95);
`;
