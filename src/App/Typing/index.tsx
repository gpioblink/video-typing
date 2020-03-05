import React from "react";
import {Style} from "./style"
import {Window} from "../TypingPart/Window";
import {CharsData, TagsData} from "../../stories/3-Window.stories";
import {Score} from "../ScorePart/Score";
import {Hint} from "../HintPart/Hint";
import {DictionaryWordData} from "../../stories/8-Hint.stories";
import {VideoPlayer} from "../VideoPart/VideoPlayer";
import {YoutubeMpegData} from "../../stories/4-VideoPlayer.stories";

export const Typing: React.FC = () => {
    return (
        <Style>
            <div className="width ratio16-9">
                <div className="grid">
                    <div className="video">
                        <VideoPlayer mode={"standard"} startTime={5} endTime={10} playerProps={{sources: [YoutubeMpegData]}} />
                    </div>
                    <div className="typing">
                        <div className="box"><Window frame={ {caption: CharsData, tags: TagsData, id: 'frgersgsr'} } sendCompleted={() => {}}/></div>
                    </div>
                    <div className="info">
                        <Score mode={"native"} unaudibleCount={30} spellingCount={43} ignoranceCount={22} othersCount={332}/>
                        <div className="spacer" />
                        <div className="autobox"><Hint words={DictionaryWordData} /></div>
                    </div>
                </div>
            </div>
        </Style>
    )
};

export default Typing
