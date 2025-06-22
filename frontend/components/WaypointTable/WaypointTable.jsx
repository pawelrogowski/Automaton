import React from 'react'; // We need the main React object for React.memo and React.useCallback
import { useSelector, useDispatch } from 'react-redux';
import { reorderWaypoints, setSelectedWaypointId } from '../../redux/slices/cavebotSlice.js';
import { useTable, useBlockLayout, useResizeColumns } from 'react-table';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useDrag, useDrop } from 'react-dnd';
import { StyledWaypointTable } from './WaypointTable.styled.js';

// --- STEP 1: Define the Row Component OUTSIDE the main component and wrap it in React.memo ---
// React.memo prevents this component from re-rendering if its props haven't changed.
const WaypointRow = React.memo(({ index, row, children, isSelected, onSelect, onMoveRow }) => {
  const [{ isDragging }, drag] = useDrag({
    type: 'row',
    item: { index },
    collect: (monitor) => ({
      isDragging: monitor.isDragging(),
    }),
  });

  const [, drop] = useDrop({
    accept: 'row',
    hover: (item) => {
      if (item.index === index) return;
      // Use the stable onMoveRow function passed from the parent
      onMoveRow(item.index, index);
      item.index = index;
    },
  });

  return (
    <div
      ref={(node) => drag(drop(node))}
      style={{ opacity: isDragging ? 0.5 : 1 }}
      {...row.getRowProps()}
      // Use the isSelected prop for the className
      className={`tr ${isSelected ? 'selected' : ''}`}
      // We can now reliably use onClick because the unnecessary re-renders are gone
      onClick={() => onSelect(row.original.id)}
    >
      {children}
    </div>
  );
});

// --- The Main Table Component ---
const WaypointTable = () => {
  const dispatch = useDispatch();
  const waypoints = useSelector((state) => state.cavebot.waypoints);
  const selectedWaypointId = useSelector((state) => state.cavebot.selectedWaypointId);

  // --- STEP 2: Wrap event handlers in React.useCallback ---
  // This ensures the functions themselves don't change on every render,
  // which is essential for React.memo to work correctly.
  const handleSelectRow = React.useCallback(
    (id) => {
      dispatch(setSelectedWaypointId(id));
    },
    [dispatch],
  ); // dispatch is stable and won't change.

  const handleMoveRow = React.useCallback(
    (dragIndex, hoverIndex) => {
      dispatch(reorderWaypoints({ startIndex: dragIndex, endIndex: hoverIndex }));
    },
    [dispatch],
  );

  const data = React.useMemo(() => waypoints, [waypoints]);

  const columns = React.useMemo(
    () => [
      { Header: 'ID', accessor: 'id', width: 39 },
      { Header: 'Type', accessor: 'type', width: 67 },
      {
        Header: 'Coordinates',
        accessor: 'x',
        width: 134,
        Cell: ({ row }) => <span>{`${row.original.x}, ${row.original.y}, ${row.original.z}`}</span>,
      },
      { Header: 'Range', accessor: 'range', width: 51 },
      { Header: 'Action', accessor: 'action', width: 400 },
    ],
    [],
  );

  const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow } = useTable(
    { columns, data },
    useBlockLayout,
    useResizeColumns,
  );

  return (
    <DndProvider backend={HTML5Backend}>
      <StyledWaypointTable>
        <div {...getTableProps()} className="table">
          <div className="thead">
            {headerGroups.map((headerGroup) => (
              <div {...headerGroup.getHeaderGroupProps()} className="tr header-group">
                {headerGroup.headers.map((column) => (
                  <div {...column.getHeaderProps()} className="th">
                    {column.render('Header')}
                    {column.canResize && (
                      <div {...column.getResizerProps()} className={`resizer ${column.isResizing ? 'isResizing' : ''}`} />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div {...getTableBodyProps()} className="tbody">
            {/* --- STEP 3: Render the memoized component with stable props --- */}
            {rows.map((row, i) => {
              prepareRow(row);
              return (
                <WaypointRow
                  key={row.original.id}
                  index={i}
                  row={row}
                  // Pass the memoized functions as props
                  onSelect={handleSelectRow}
                  onMoveRow={handleMoveRow}
                  // Calculate the isSelected prop here
                  isSelected={selectedWaypointId === row.original.id}
                >
                  {/* The children are the rendered cells */}
                  {row.cells.map((cell) => (
                    <div {...cell.getCellProps()} className="td">
                      {cell.render('Cell')}
                    </div>
                  ))}
                </WaypointRow>
              );
            })}
          </div>
        </div>
      </StyledWaypointTable>
    </DndProvider>
  );
};

export default WaypointTable;
