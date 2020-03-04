import React, {FC} from "react";
import {PlayMode} from "../../VideoPart/VideoPlayer";
import {Layout} from "./style";

interface Props {
    mode: PlayMode;
}

export const Mode: FC<Props> = ({mode}) => {

    const getCurrentStatus = (): string => {
        switch(mode){
            case "slow":
                return "[ミスx5] もう少し! ヒントとして交互にスロー再生しています";
            case "native":
                return "[ミスx10] 頑張れ! ヒントとして日本語と英語を交互に再生しています";
        }
        return "";
    };

  return (
      <Layout>
          <div className="window"><div className="mode">{getCurrentStatus()}</div></div>
      </Layout>
  );
};
