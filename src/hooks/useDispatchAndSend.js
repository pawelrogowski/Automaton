import { useDispatch } from 'react-redux';

const useDispatchAndSend = () => {
  const dispatch = useDispatch();

  const dispatchAndSend = (action) => {
    dispatch(action);
    window.electron.ipcRenderer.send('state-change', action);
    console.log('Dispatching action:', action);
  };

  return dispatchAndSend;
};

export default useDispatchAndSend;
