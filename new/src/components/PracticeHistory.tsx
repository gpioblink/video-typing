import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  listExternalHistoryItems,
  loadStoredTypingProgress,
  loadStoredSubtitle,
} from '../lib/storage';
import { createUnknownWordCsv } from '../lib/localPlayerReview';
import { createAnkiTsv } from '../lib/ankiExport';
import { summarizePracticeHistory } from '../lib/practiceHistory';
import type { ExternalHistoryItem } from '../types';

interface Props {
  onResume: (item: ExternalHistoryItem) => void | Promise<void>;
  onReview: (item: ExternalHistoryItem) => void | Promise<void>;
  onRestart: (item: ExternalHistoryItem) => void | Promise<void>;
  revision?: number;
}

const MAX_VISIBLE_ITEMS = 20;

export function PracticeHistory({ onResume, onReview, onRestart, revision = 0 }: Props) {
  const [items, setItems] = useState<ExternalHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const downloads = useRef(new Map<string, number>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const [url, timer] of downloads.current) {
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      downloads.current.clear();
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void listExternalHistoryItems()
      .then((next) => {
        if (active) setItems(next);
      })
      .catch(() => {
        if (active) setError('学習履歴を読み込めませんでした。もう一度更新してください。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision, refresh]);
  const visible = useMemo(
    () =>
      items
        .slice(0, MAX_VISIBLE_ITEMS)
        .map((item) => ({ item, summary: summarizePracticeHistory(item) })),
    [items],
  );
  const runAction = async (action: () => void | Promise<void>) => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await action();
    } catch (reason) {
      if (mounted.current)
        setError(reason instanceof Error ? reason.message : '操作に失敗しました。');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const download = (text: string, mimeType: string, name: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: `${mimeType};charset=utf-8` }));
    const link = document.createElement('a');
    try {
      link.href = url;
      link.download = name;
      document.body.append(link);
      link.click();
      downloads.current.set(
        url,
        window.setTimeout(() => {
          URL.revokeObjectURL(url);
          downloads.current.delete(url);
        }, 1000),
      );
    } catch (reason) {
      URL.revokeObjectURL(url);
      throw reason;
    } finally {
      link.remove();
    }
  };
  const exportUnknown = async (item: ExternalHistoryItem, format: 'csv' | 'anki') => {
    const [subtitle, typingProgress] = await Promise.all([
      loadStoredSubtitle(item.url),
      loadStoredTypingProgress(item.url),
    ]);
    if (!subtitle) throw new Error('字幕が削除されています。履歴を更新してください。');
    const current = { ...item, subtitle, typingProgress };
    const summary = summarizePracticeHistory(current);
    if (!summary.unknownWordRows.length) {
      setStatus('現在の復習対象はありません。');
      setRefresh((value) => value + 1);
      return;
    }
    const name = item.title.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'video-typing';
    if (format === 'csv') {
      download(createUnknownWordCsv(summary.unknownWordRows), 'text/csv', `${name}-unknown-words.csv`);
    } else {
      download(createAnkiTsv(subtitle, typingProgress, item.url), 'text/tab-separated-values', `${name}-anki.tsv`);
    }
    setStatus(
      format === 'csv'
        ? `${summary.unknownWordRows.length} 件の単語をCSV出力しました。`
        : 'Anki用TSVを出力しました。',
    );
  };
  return (
    <section className="playerPanel" aria-label="学習履歴">
      <div className="playerHeader">
        <h2>学習履歴</h2>
        <button
          className="playerButton"
          type="button"
          disabled={loading || busy}
          onClick={() => setRefresh((value) => value + 1)}
        >
          履歴を更新
        </button>
      </div>
      <p>このブラウザに保存した動画・字幕と学習記録です。</p>
      {loading && <p role="status">履歴を読み込んでいます…</p>}
      {error && (
        <p role="alert" className="statusText">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="statusText">
          {status}
        </p>
      )}
      {!loading && !error && visible.length === 0 && (
        <p>まだ学習履歴はありません。クリップを開くと、ここから続きを練習できます。</p>
      )}
      <div className="historyList">
        {visible.map(({ item, summary }) => {
          const unavailable = busy || loading || !item.subtitle;
          return (
            <article className="historyCard" key={item.url}>
              <div className="historyCardBody">
                <strong>{item.title}</strong>
                <span>{item.url}</span>
                <span>
                  {item.subtitle
                    ? `完了 ${summary.completedCues} / ${summary.totalCues} 問 · 復習 ${summary.reviewFrames.length} 問 · 知らなかった単語 ${summary.unknownWordCount} 件`
                    : '字幕データなし'}
                </span>
                <span>
                  {Number.isFinite(item.updatedAt) && item.updatedAt > 0
                    ? new Date(item.updatedAt).toLocaleString('ja-JP')
                    : '日時未記録'}
                </span>
              </div>
              <div className="historyActions">
                <button
                  className="playerButton"
                  type="button"
                  disabled={unavailable}
                  onClick={() => void runAction(() => onResume(item))}
                >
                  続きから開く
                </button>
                <button
                  className="playerButton"
                  type="button"
                  disabled={unavailable || summary.reviewFrames.length === 0}
                  onClick={() => void runAction(() => onReview(item))}
                >
                  復習する
                </button>
                <button
                  className="playerButton"
                  type="button"
                  disabled={unavailable}
                  onClick={() => void runAction(() => onRestart(item))}
                >
                  最初から再挑戦
                </button>
                <button
                  className="playerButton"
                  type="button"
                  disabled={unavailable || summary.unknownWordRows.length === 0}
                  onClick={() => void runAction(() => exportUnknown(item, 'csv'))}
                >
                  単語CSV出力
                </button>
                <button
                  className="playerButton"
                  type="button"
                  disabled={unavailable || summary.unknownWordRows.length === 0}
                  onClick={() => void runAction(() => exportUnknown(item, 'anki'))}
                >
                  Anki用TSV出力
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {items.length > MAX_VISIBLE_ITEMS && <p>最新{MAX_VISIBLE_ITEMS}件を表示しています。</p>}
      {visible.length > 0 && (
        <p className="statusText">
          単語の出力対象は、辞書の意味を選んで「知らなかった」と記録した項目です。
        </p>
      )}
    </section>
  );
}
