import styled from 'styled-components';

export const StyledDiv = styled.div`
  width: 100%;
  background: #414141;
  height: auto;
  border-top: 1px solid #181818;
  border-left: 1px solid #181818;
  border-right: 1px solid #7d7d7d;
  border-bottom: 1px solid #7d7d7d;
  min-height: 221px;
  overflow-y: scroll;
  min-width: 681px;
  .header {
    background: #363636;
    display: flex;
    flex-direction: row;
    /* border-bottom: 1px solid #292929; */
    color: #c0c0c0;
    font-size: 11px;
    .header-item {
      text-align: center;
      border-right: 1px solid #181818;
    }
    .header-item_1 {
      width: 22px;
      min-width: 22px;
    }
    .header-item_2 {
      width: 100px;
      min-width: 100px;
    }
    .header-item_3 {
      width: 90px;
      min-width: 90px;
    }
    .header-item_4 {
      width: 60px;
      min-width: 60px;
    }
    .header-item_5 {
      width: 94px;
      min-width: 94px;
    }
    .header-item_6 {
      width: 94px;
      min-width: 94px;
    }
    .header-item_7 {
      width: 90px;
      min-width: 90px;
    }
    .header-item_8 {
      width: 85px;
      min-width: 85px;
    }
    .header-placeholder {
      width: 100%;
    }
  }
`;
