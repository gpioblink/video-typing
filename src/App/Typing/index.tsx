import React, {useState} from "react";
import {Style} from "./style"
import {Window} from "../TypingPart/Window";
import {Score} from "../ScorePart/Score";
import {Hint} from "../HintPart/Hint";
import {VideoPlayer, VideoPlayerProps} from "../VideoPart/VideoPlayer";
import {Caption, DictionaryWord, TagContent} from "../../index";

interface Props {
    caption: Caption[]; // TODO: captionFrame.tagsは本来こっちのデータにはいらないものだから別の場所に格納したい。
    videoSources: VideoPlayerProps;
}

export const Typing: React.FC<Props> = ({caption, videoSources }) => {
    const [ captionIndex, setCaptionIndex ] = useState(0);
    const [ unaudibleCount, setUnaudibleCount ] = useState(0);
    const [ spellingCount, setSpellingCount ] = useState(0);
    const [ ignoranceCount, setIgnoranceCount ] = useState(0);
    const [ othersCount, setOhtersCount ] = useState(0);
    const initDictionaryWords: DictionaryWord[] = [];
    const [ dictionaryWord, setDictionaryWord ] = useState(initDictionaryWords);

    const searchDictionary = (query: string) => {
        setDictionaryWord(state => {
           state.push({title: query, content: "プロジェクト毎投稿は、記事・条件がさ原則はtheますあることを要件をし以下で、引用の付とすることにタイトルによる、財団には厳しいフリーの方針がさたます。その方針の事典によって、米国の利用者者と、主著作名(CC記事要件要件記事ライセンス事項サーバ)の投稿権書きとしてドメイン明記修正のことます、出所を可能ないませのを著作しています。内容権削除は俳句用語の引用に機密をさますこととするられますて、下フリーの引用と記事の引用でも、執筆物版上の著作は付としてそのならんことが、本記事がもライセンス権禁止の方針で削除心掛けれれことを守らた。それに、目的物フリーの百科の被許諾法もアメリカ合衆国権にさます。日本の回避家物がして、著作権の方針をさている著作性で、投稿法名の説明をさこと無い執筆科さ抜粋は、フリーといった投稿者引用としで。"});
            return state;
        });
    };

    const countMiss = (reason: TagContent) => {
        switch(reason){
            case "unaudible":
                setUnaudibleCount(prev => prev + 1);
                break;
            case "spelling":
                setSpellingCount(prev => prev + 1);
                break;
            case "ignorance":
                setIgnoranceCount(prev => prev + 1);
                break;
            default:
                setOhtersCount(prev => prev + 1);
                break;
        }
    };

    const nextCaption = () => {
        setCaptionIndex( (state:number) => {
            return Math.min(state +1, caption.length-1)
        })
    };

    return (
        <Style>
            <div className="width ratio16-9">
                <div className="grid">
                    <div className="video">
                        <VideoPlayer mode={"standard"} startTime={caption[captionIndex].startTime} endTime={caption[captionIndex].endTime} playerProps={videoSources} />
                    </div>
                    <div className="typing">
                        <div className="box"><Window frame={ {caption: caption[captionIndex].content.caption, tags: caption[captionIndex].content.tags, id: caption[captionIndex].content.id } } sendCompleted={nextCaption} requestExplanation={searchDictionary} sendMistake={countMiss}/></div>
                    </div>
                    <div className="info">
                        <Score mode={"native"} unaudibleCount={unaudibleCount} spellingCount={spellingCount} ignoranceCount={ignoranceCount} othersCount={othersCount}/>
                        <div className="spacer" />
                        <div className="autobox"><Hint words={dictionaryWord} /></div>
                    </div>
                </div>
            </div>
        </Style>
    )
};

export default Typing
