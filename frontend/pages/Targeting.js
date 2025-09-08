import React, { useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useTable, useBlockLayout } from 'react-table';
import styled from 'styled-components';
import { Crosshair, Navigation } from 'react-feather';
import StyledTargeting from './Targeting.styled.js';
import TargetingTable from '../components/TargetingTable/TargetingTable.jsx';
import SelectControl from '../components/NodeRangeControl/SelectControl.jsx';
import { setUseBattleList } from '../redux/slices/targetingSlice.js';
import { StyledWaypointTable } from '../components/WaypointTable/WaypointTable.styled.js';

const TargetingContainer = styled.div`
  display: flex;
  width: 100%;
  gap: 10px;
  height: 100%;
`;

const MainColumn = styled.div`
  flex: 0 0 65%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0; /* Prevent overflow */
`;

const SideColumn = styled.div`
  flex: 0 0 35%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0; /* Prevent overflow */
`;

const CreatureList = () => {
  const { creatures, target } = useSelector((state) => state.targeting);
  const { dynamicTarget } = useSelector((state) => state.cavebot);
  const pathfindingTargetId = dynamicTarget?.targetInstanceId;
  const currentTargetId = target?.instanceId;

  const data = useMemo(() => {
    return [...creatures].sort((a, b) => a.instanceId - b.instanceId);
  }, [creatures]);

  const columns = useMemo(
    () => [
      {
        Header: 'Name',
        accessor: 'name',
        width: 100,
      },
      {
        Header: 'Health',
        accessor: 'healthTag',
        width: 60,
      },
      {
        Header: 'Dist',
        accessor: 'distance',
        width: 40,
      },
      {
        Header: 'Targeted',
        id: 'targeted',
        width: 50,
        Cell: ({ row }) => {
          const isTargeted = row.original.instanceId === currentTargetId;
          return isTargeted ? <Crosshair size={14} /> : null;
        },
      },
      {
        Header: 'Pathing',
        id: 'pathing',
        width: 50,
        Cell: ({ row }) => {
          const isPathingTarget = row.original.instanceId === pathfindingTargetId;
          return isPathingTarget ? <Navigation size={14} /> : null;
        },
      },
    ],
    [currentTargetId, pathfindingTargetId]
  );

  const { getTableProps, getTableBodyProps, headerGroups, rows, prepareRow } =
    useTable({ columns, data }, useBlockLayout);

  return (
    <StyledWaypointTable>
      <div {...getTableProps()} className="table">
        <div className="thead">
          {headerGroups.map((headerGroup) => (
            <div {...headerGroup.getHeaderGroupProps()} className="tr">
              {headerGroup.headers.map((column) => (
                <div {...column.getHeaderProps()} className="th">
                  {column.render('Header')}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div {...getTableBodyProps()} className="tbody">
          {rows.map((row) => {
            prepareRow(row);
            return (
              <div {...row.getRowProps()} className="tr">
                {row.cells.map((cell) => (
                  <div {...cell.getCellProps()} className="td">
                    {cell.render('Cell')}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </StyledWaypointTable>
  );
};

const Targeting = () => {
  const dispatch = useDispatch();
  const { target, useBattleList } = useSelector((state) => state.targeting);

  const handleUseBattleListChange = (value) => {
    dispatch(setUseBattleList(value));
  };

  return (
    <StyledTargeting>
      <TargetingContainer>
        <MainColumn>
          <div className="settings-container">
            <div className="setting-row">
              <SelectControl
                label="Use BattleList"
                value={useBattleList}
                onChange={handleUseBattleListChange}
                options={[
                  { value: true, label: 'Yes' },
                  { value: false, label: 'No' },
                ]}
              />
            </div>
          </div>
          <TargetingTable />
        </MainColumn>
        <SideColumn>
          <CreatureList />
        </SideColumn>
      </TargetingContainer>

      
    </StyledTargeting>
  );
};

export default Targeting;