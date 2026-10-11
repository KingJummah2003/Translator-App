import { Fragment } from 'react';
import { Text as RNText } from 'react-native';
import { useColors } from '@/theme';
import { Text, type Props as TextProps } from './Text';

const WORD = /(\p{L}[\p{L}\p{M}'’\-]*)/u;

/** Renders text where every word can be tapped (opens the dictionary). */
export function TappableText({
  text,
  lang,
  variant,
  onWord,
}: {
  text: string;
  lang: string;
  variant?: TextProps['variant'];
  onWord: (word: string) => void;
}) {
  const c = useColors();
  const parts = text.split(WORD);
  return (
    <Text variant={variant} language={lang} selectable>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <RNText
            key={i}
            onPress={() => onWord(part)}
            suppressHighlighting={false}
            style={{ textDecorationLine: 'underline', textDecorationColor: c.border, textDecorationStyle: 'dotted' }}>
            {part}
          </RNText>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </Text>
  );
}
