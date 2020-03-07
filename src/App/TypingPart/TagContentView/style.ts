import styled from '@emotion/styled'

export interface LayoutProps {
    position: TagPosition
}

export interface TagPosition {
    startPosition: number
    lastPosition: number
}

export const Style = styled.div<LayoutProps>`
 grid-row-start: tag-start;
 grid-column-start: ${ (props: LayoutProps) => props.position.startPosition + 1 };
 grid-column-end: ${ (props: LayoutProps) => props.position.lastPosition + 2};
 justify-self: center;
 font-size: 50%;
 color: #86AC41;
`;
