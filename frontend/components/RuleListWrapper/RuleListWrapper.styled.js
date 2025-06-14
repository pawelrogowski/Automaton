import styled from 'styled-components';

export const StyledDiv = styled.div`
  width: 100%;
  height: auto;
  min-height: 260.5px;
  min-width: 681px;
  position: relative;
  // & * {
  //   background: transparent !important;
  //   border: none !important;
  // }
  .header {
    display: flex;
    background-color: #373737;
    border-bottom: 1px solid #2c2c2c;
    padding: 0px 0px;
  }

  .header-item {
    color: #a5a5a5;
    font-size: 10px;
    text-align: center;
    cursor: pointer;
    padding: 0 0px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: flex;         /* Use flexbox */
    align-items: center;   /* Center vertically */
    justify-content: center; /* Center horizontally */
    height: 18px;          /* Example fixed height */
    flex-shrink: 0; /* Prevent shrinking by default */
    box-sizing: border-box; /* Include padding/border in width */
     &:hover {
      filter: brightness(1.2);
    }
    /* Ensure nested images fit */
    img {
      max-height: 100%;
      max-width: 100%;
      object-fit: contain;
    }
  }
   /* Remove borders for first/last visible item? Or adjust padding */
   .header-item:first-child {
     border-left: none;
   }
  .header-placeholder {
     border-right: none;
     flex-grow: 1; /* Takes remaining space */
     cursor: default;
     flex-shrink: 1; /* Allow placeholder to shrink if needed */
     min-width: 10px; /* Prevent collapsing */
     margin-left: 0; /* Reset any potential margin */
      &:hover { filter: none; }

   }

  /* --- Default/UserRule/ManaSync Variant Header Widths --- */
  .header-default-enable { width: 22px; }
  .header-default-name { width: 100px; }
  .header-default-category { width: 90px; }
  .header-default-hk { width: 60px; }
  .header-default-hp { width: 94px; }      // Expects 46+48 input combo
  .header-default-mana { width: 94px; }     // Expects ~47px input
  .header-default-monster { width: 94px; }  // Expects ~47px input
  .header-default-priority { width: 90px; }

  /* --- Action Bar Variant Header Widths --- */
  .header-actionbar-enable { width: 36px; }
  .header-actionbar-item { width: 260px; }
  .header-actionbar-hk { width: 60px; }
  .header-actionbar-hp { width: 82px; }       // Expects 34+48 input combo
  .header-actionbar-mana { width: 82px; } /* Split original 164px */
  .header-actionbar-monster { width: 82px; } /* Split original 164px */
  .header-actionbar-priority { width: 80px; }
  .header-actionbar-cd { width: 100px; }

  /* --- Equip Variant Header Widths (Same as Action Bar) --- */
  .header-equip-enable { width: 36px; }
  .header-equip-item { width: 260px; }
  .header-equip-hk { width: 60px; }
  .header-equip-hp { width: 82px; }
  .header-equip-mana { width: 82px; }
  .header-equip-monster { width: 82px; }
  .header-equip-priority { width: 80px; }
  /* Note: .header-equip-cd can be added if needed, following actionbar's 100px */

  /* --- Friend Variant Header Widths - Updated --- */
  .header-friend-enable { width: 36px; }      // Match action bar enable
  .header-friend-action { width: 162px; }     // New: Match action bar item width
  .header-friend-hk { width: 60px; }          // Keep consistent
  .header-friend-wait-atk { width: 83px; }    // Match checkbox width
  .header-friend-party-member { width: 128px; } // Adjust as needed
  .header-friend-member-hp { width: 112px; }   // Match action bar HP/Mana combo width (34+48)
  .header-friend-priority { width: 80px; }    // Match action bar priority
  .header-friend-cd { width: 100px; }         // Match action bar CD

  /* --- ManaSync Variant Header Widths --- */
  .header-manasync-enable { width: 36px; }     /* Matches Checkbox */
  .header-manasync-item { width: 260px; }    /* Matches CustomIconSelect wrapper */
  .header-manasync-hk { width: 60px; }       /* Matches Hotkey Select */
  .header-manasync-hp { width: 82px; }       /* Matches HP Select (34) + Input (48) */
  .header-manasync-mana { width: 82px; }     /* Matches Mana Select (34) + Input (48) */
  .header-manasync-priority { width: 80px; } /* Added priority header width */

  .rules {
    display: flex;
    flex-direction: column;
    height: calc(100% - 24px); /* Adjust based on actual header height + margin */
    max-height: 420px; /* Ensure it fits within the box */
    overflow-y: scroll;
    gap: 8px;
  }
`;
