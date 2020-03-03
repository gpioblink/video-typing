import React, {FC} from "react";
import {Style, TagPosition} from "./style";

interface Props {
    position: TagPosition
}

export const TagLineView: FC<Props> = ({ position }) => {
    return(
        <Style position={position}/>
    )
};
