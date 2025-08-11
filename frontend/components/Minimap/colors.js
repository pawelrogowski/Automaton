export const MINIMAP_COLORS = {
  // Colors for different types of waypoints.
  WAYPOINT_TYPE: {
    Node: '#3498db', // Peter River Blue
    Stand: '#f1c40f', // Sun Flower
    Ladder: '#e67e22', // Carrot
    Script: '#2ecc71', // Emerald
    Lure: '#d35400', // Pumpkin
    Default: '#bdc3c7', // Silver
  },

  // Stroke colors to indicate the state of a waypoint.
  WAYPOINT_STATE_STROKE: {
    selected: '#000000', // Black
    active: '#FF00FF', // High-contrast Magenta
    default: '#000000', // Black
  },

  // Color for the lines connecting path waypoints.
  PATH: '#FF00FF', // High-contrast Magenta

  // Shadow color for enhanced visibility.
  SHADOW: 'black',

  // Color for the player's marker on the map.
  PLAYER: '#e74c3c', // Alizarin Red

  // Color for hostile entities.
  ENTITY: '#FF0000', // Bright Red

  // Fill and stroke colors for special areas.
  SPECIAL_AREA: {
    fill: 'rgba(0, 100, 255, 0.4)',
    stroke: 'rgba(100, 150, 255, 0.8)',
  },
};
