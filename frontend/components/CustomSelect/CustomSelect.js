import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import {
  SelectContainer,
  StyledDisplay,
  Dropdown,
  OptionItem,
} from './CustomSelect.styled.js';

const CustomSelect = ({ value, options, onChange, className, id }) => {
  const [is_open, set_is_open] = useState(false);
  const container_ref = useRef(null);

  const handle_toggle_dropdown = () => {
    set_is_open(!is_open);
  };

  const handle_option_click = (option_value) => {
    if (onChange) {
      // Mimic native event structure
      onChange({ target: { value: option_value } });
    }
    set_is_open(false);
  };

  useEffect(() => {
    const handle_click_outside = (event) => {
      if (
        container_ref.current &&
        !container_ref.current.contains(event.target)
      ) {
        set_is_open(false);
      }
    };

    document.addEventListener('mousedown', handle_click_outside);
    return () => {
      document.removeEventListener('mousedown', handle_click_outside);
    };
  }, [container_ref]);

  const selected_option_label =
    options.find((option) => option.value === value)?.label || value;

  return (
    <SelectContainer className={className} ref={container_ref} id={id}>
      <StyledDisplay onClick={handle_toggle_dropdown}>
        {selected_option_label}
      </StyledDisplay>
      {is_open && (
        <Dropdown>
          {options.map((option) => (
            <OptionItem
              key={option.value}
              onClick={() => handle_option_click(option.value)}
              $is_selected={option.value === value}
            >
              {option.label}
            </OptionItem>
          ))}
        </Dropdown>
      )}
    </SelectContainer>
  );
};

CustomSelect.propTypes = {
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
        .isRequired,
      label: PropTypes.string.isRequired,
    }),
  ).isRequired,
  onChange: PropTypes.func,
  className: PropTypes.string,
  id: PropTypes.string,
};

export default CustomSelect;
