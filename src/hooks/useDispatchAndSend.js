import { useDispatch } from 'react-redux';

const useDispatchAndSend = () => {
  const dispatch = useDispatch();

  const dispatchAndSend = (action) => {
    dispatch(action);
    window.electron.ipcRenderer.send('dispatch', action);
  };

  return dispatchAndSend;
};

export default useDispatchAndSend;
