import styled from 'styled-components';

export const StyledDiv = styled.div`
  width: 100%;
  background: #414141;
  height: auto;
  border-top: 1px solid #181818;
  border-left: 1px solid #181818;
  border-right: 1px solid #7d7d7d;
  border-bottom: 1px solid #7d7d7d;
  min-height: 260.5px;
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
    .header-item_9 {
      width: 55px;
      min-width: 55px;
    }
    .header-item_10 {
      width: 35px;
      min-width: 35px;
    }
    .header-item_11 {
      width: 85px;
      min-width: 85px;
    }
    .header-item_wait-atk {
      width: 100px;
      min-width: 100px;
    }
    .header-item_party-member {
      width: 126px;
      min-width: 126px;
    }
    .header-item_member-hp {
      width: 156px;
      min-width: 156px;
    }
    .header-item_running {
      width: 22px;
      min-width: 22px;
      display: flex;
      justify-content: center;
      align-items: center;
      padding-top: 2px;
      > img {
        padding: 1px 2px;
        width: 16px;
        height: 16px;
      }
    }
    .header-placeholder {
      width: 100%;
    }
  }

  .rules {
    height: 425px;
    min-height: 425px;
    max-height: 425px;
    overflow-y: scroll;
  }
`;
