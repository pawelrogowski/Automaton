import styled from 'styled-components';

export const SelectContainer = styled.div`
  position: relative;
  display: inline-block;
  width: 100%;
`;

export const StyledDisplay = styled.div`
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  background: rgba(44, 44, 44, 0.95);
  color: #fafafa;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  user-select: none;
`;

export const Dropdown = styled.div`
  height: 200px !important;
  z-index: 2000;
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  z-index: 1001;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-top: none;
  border-radius: 0 0 4px 4px;
  background: rgba(44, 44, 44, 0.95);

  max-height: 200px;
  overflow-y: auto;

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

export const OptionItem = styled.div`
  padding: 8px 12px;
  cursor: pointer;
  color: #ffffff;
  background-color: ${({ $is_selected }) => ($is_selected ? 'rgba(76, 175, 80, 0.2)' : 'transparent')};
  &:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }
`;
