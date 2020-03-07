import styled from '@emotion/styled'

export interface LayoutProps {
    position: TagPosition
}

export interface TagPosition {
    startPosition: number
    lastPosition: number
}

export const Style = styled.div<LayoutProps>`
    grid-row-start: line-start;
    grid-column-start: ${ (props: LayoutProps) => props.position.startPosition + 1 };
    grid-column-end: ${ (props: LayoutProps) => props.position.lastPosition + 2};
    background-color: #86Ac41;
`;
