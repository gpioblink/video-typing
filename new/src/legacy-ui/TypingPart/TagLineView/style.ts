import styled from '@emotion/styled';

export interface TagPosition {
  startPosition: number;
  lastPosition: number;
}

export const Style = styled.div<{ position: TagPosition }>`
  grid-row-start: line-start;
  grid-column-start: ${(props) => props.position.startPosition + 1};
  grid-column-end: ${(props) => props.position.lastPosition + 2};
  background-color: #86ac41;
`;
