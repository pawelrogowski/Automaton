import React, { useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useTable, useBlockLayout } from 'react-table';
import styled from 'styled-components';
import {
  Crosshair,
  Navigation,
  AlertTriangle,
  UserCheck,
} from 'react-feather';
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
  flex: 0 0 60%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0; /* Prevent overflow */
`;

const SideColumn = styled.div`
  flex: 0 0 40%;
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
    return [...creatures].sort((a, b) => {
      if (a.distance < b.distance) return -1;
      if (a.distance > b.distance) return 1;
      return a.instanceId - b.instanceId;
    });
  }, [creatures]);

  const columns = useMemo(
    () => [
      {
        Header: 'Name',
        accessor: 'name',
        width: 110,
      },
      {
        Header: 'HP',
        accessor: 'hp',
        width: 50,
      },
      {
        Header: 'Dist',
        accessor: 'distance',
        width: 50,
      },
      {
        Header: 'Adj',
        accessor: 'isAdjacent',
        width: 50,
        Cell: ({ value }) => (value ? <UserCheck size={14} /> : null),
      },
      {
        Header: 'Blocking',
        accessor: 'isBlockingPath',
        width: 80,
        Cell: ({ value }) => (value ? <AlertTriangle size={14} /> : null),
      },
      {
        Header: 'Target',
        id: 'targeted',
        width: 80,
        Cell: ({ row }) => {
          const isTargeted = row.original.instanceId === currentTargetId;
          return isTargeted ? <Crosshair size={14} /> : null;
        },
      },
      {
        Header: 'Path',
        id: 'pathing',
        width: 70,
        Cell: ({ row }) => {
          const isPathingTarget =
            row.original.instanceId === pathfindingTargetId;
          return isPathingTarget ? <Navigation size={14} /> : null;
        },
      },
    ],
    [currentTargetId, pathfindingTargetId],
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
            const isUnreachable = !row.original.isReachable;
            const rowStyle = isUnreachable
              ? { color: '#777', fontStyle: 'italic' }
              : {};
            return (
              <div {...row.getRowProps({ style: rowStyle })} className="tr">
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
