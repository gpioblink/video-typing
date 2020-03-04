import React from "react";
import {Hint} from "../App/HintPart/Hint";
import {DictionaryWord} from "../index";

export default {
    title: 'Hint',
    components: Hint,
    excludeStories: /.*Data$/,
};

export const DictionaryWordData: DictionaryWord[] = [
    {title: 'rain cats and dogs', content: '雨が激しく［土砂降りに・ひどく］降る、大雨が降る◆【語源】北欧神話で、猫は雨を降らせる力があり、犬は風を起こす力があると信じられていた。■・It\'s raining (like) cats and dogs. 土砂降りだあ！■・It rains (like) cats and dogs. 土砂降りの雨です。' },
    {title: 'rain', content: '{自動-1} : 〔雲から〕雨が降る◆【用法】主語にはitが用いられる。■・I think it may rain tomorrow. 明日は雨だと思うよ。■・It will rain in some areas. ところにより雨。◆天気予報 {自動-2} : 〔雲などが〕雨を降らす {自動-3} : 〔灰や爆弾などが〕降り注ぐ {自動-4} : 〔頭髪や枝などが〕降り懸かる {自動-5} : 〔称賛などが〕浴びせられる {自動-6} : 〈米話〉台無しにする、けちをつける {他動-1} : 〔雨のように～を〕降り注ぐ、降りかける {他動-2} : 〔称賛などを〕浴びせる、惜しみなく与える {名-1} : 〔雲から降る水の〕雨◆【用法】降らない霧(mist)などと区別して用いる。 {名-2} : 〔さまざまな形態の〕雨◆【用法】pouring rainやheavy rainなどのように、形容詞と共に用いられることが多い。 {名-3} : 《the rains》〔熱帯の〕雨期 {名-4} : 〔長く続く天気の〕雨、雨天 {名-5} : 〈比喩〉〔大量に降る微少物の〕雨 【レベル】1、【発音】re\'in、【＠】レイン、【変化】《動》rains | raining | rained' },
    {title: 'rain cats and dogs', content: '雨が激しく［土砂降りに・ひどく］降る、大雨が降る◆【語源】北欧神話で、猫は雨を降らせる力があり、犬は風を起こす力があると信じられていた。■・It\'s raining (like) cats and dogs. 土砂降りだあ！■・It rains (like) cats and dogs. 土砂降りの雨です。' },
    {title: 'rain', content: '{自動-1} : 〔雲から〕雨が降る◆【用法】主語にはitが用いられる。■・I think it may rain tomorrow. 明日は雨だと思うよ。■・It will rain in some areas. ところにより雨。◆天気予報 {自動-2} : 〔雲などが〕雨を降らす {自動-3} : 〔灰や爆弾などが〕降り注ぐ {自動-4} : 〔頭髪や枝などが〕降り懸かる {自動-5} : 〔称賛などが〕浴びせられる {自動-6} : 〈米話〉台無しにする、けちをつける {他動-1} : 〔雨のように～を〕降り注ぐ、降りかける {他動-2} : 〔称賛などを〕浴びせる、惜しみなく与える {名-1} : 〔雲から降る水の〕雨◆【用法】降らない霧(mist)などと区別して用いる。 {名-2} : 〔さまざまな形態の〕雨◆【用法】pouring rainやheavy rainなどのように、形容詞と共に用いられることが多い。 {名-3} : 《the rains》〔熱帯の〕雨期 {名-4} : 〔長く続く天気の〕雨、雨天 {名-5} : 〈比喩〉〔大量に降る微少物の〕雨 【レベル】1、【発音】re\'in、【＠】レイン、【変化】《動》rains | raining | rained' },
];

export const Default = () => (
    <Hint words={DictionaryWordData} />
);
