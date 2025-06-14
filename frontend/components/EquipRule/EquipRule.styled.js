import styled from 'styled-components';

export const EquipRuleWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  color: #d3d3d3;
  &:hover {
    border: 1px solid rgba(255, 255, 255, 0.49);
  }

  input {
    font-size: 12px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
  }

  .h38 {
    height: 38px;
    > div {
      height: 38px;
    }
  }

  .hotkey-input {
    width: 100px;
  }

  .row1 {
    width: 100%;
    display: flex;
    flex-direction: row;
    gap: 8px;
    align-items: center;
     > div:has(> label > div) {
        flex-shrink: 0;
     }
  }

  .row2 {
    width: 100%;
    display: flex;
    flex-direction: row;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
     > div:has(> label > div) {
        flex-shrink: 0;
     }

    .input-group {
        display: flex;
        flex-direction: column;
        gap: 3px;
        align-items: center;
        justify-content: center;
    }
  }

   .row3 {
      width: 100%;
      display: flex;
      flex-direction: row;
      gap: 8px;
      align-items: center;
      justify-content: center;
       .conditions {
       }
   }


  .input-group {
    display: flex;
    flex-direction: column;
    gap: 3px;
    align-items:center;
    justify-content: center;
  }

  .input-row {
    display: flex;
    flex-direction: row;
    gap: 4px;
  }

  .label-text {
    font-size: 10px;
  }

  .button {
    &-expand {
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 4px;
      color: #fafafa;
      cursor: pointer;
    }
    &-remove {
      background: rgba(255, 0, 0, 0.29);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 4px;
      cursor: pointer;
      color: #fafafa;
    }
  }
`;
