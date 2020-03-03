import {Tag} from "../../../index";
import React, {FC} from "react";
import {Style, TagPosition} from "./style";

interface Props {
    tag: Tag
    position: TagPosition
}

export const TagContentView: FC<Props> = ({ tag, position }) => {
    return(
        <Style position={position}>{tag.content}</Style>
    )
};
