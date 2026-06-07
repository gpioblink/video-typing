import styled from '@emotion/styled';

export interface TagPosition {
  startPosition: number;
  lastPosition: number;
}

export const Style = styled.div<{ position: TagPosition }>`
  grid-row-start: tag-start;
  grid-column-start: ${(props) => props.position.startPosition + 1};
  grid-column-end: ${(props) => props.position.lastPosition + 2};
  justify-self: center;
  font-size: 10px;
  color: #86ac41;
`;
