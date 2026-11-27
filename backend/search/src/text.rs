//! Turning text into search terms.
//!
//! Words of letters and digits are lower-cased. Chinese, Japanese and Korean
//! text has no spaces, so it is indexed as overlapping pairs of characters
//! ("二手自行车" -> 二手, 手自, 自行, 行车): a query matches when all its
//! pairs are present, which finds any phrase of two or more characters.

use std::collections::BTreeMap;

/// Longest word kept as a term (longer ones are cut).
pub const MAX_TERM_CHARS: usize = 32;

fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x3040..=0x30FF   // Hiragana, Katakana
        | 0x3400..=0x4DBF // CJK extension A
        | 0x4E00..=0x9FFF // CJK unified ideographs
        | 0xAC00..=0xD7AF // Hangul syllables
        | 0xF900..=0xFAFF // CJK compatibility ideographs
        | 0x20000..=0x2FA1F)
}

#[derive(Debug, PartialEq, Clone, Copy)]
enum Run {
    Word,
    Cjk,
}

/// Runs of word characters and of CJK characters, lower-cased.
fn runs(s: &str) -> Vec<(Run, Vec<char>)> {
    let mut out: Vec<(Run, Vec<char>)> = vec![];
    for c in s.chars().flat_map(|c| c.to_lowercase()) {
        let kind = if is_cjk(c) {
            Some(Run::Cjk)
        } else if c.is_alphanumeric() {
            Some(Run::Word)
        } else {
            None
        };
        match (kind, out.last_mut()) {
            (Some(k), Some((last, chars))) if *last == k && !chars.is_empty() => chars.push(c),
            (Some(k), _) => out.push((k, vec![c])),
            (None, Some((_, chars))) if !chars.is_empty() => out.push((Run::Word, vec![])),
            (None, _) => {}
        }
    }
    out.retain(|(_, c)| !c.is_empty());
    out
}

/// The terms of a text, in order (with repeats).
pub fn terms(s: &str) -> Vec<String> {
    let mut out = vec![];
    for (kind, chars) in runs(s) {
        match kind {
            Run::Word => out.push(chars.iter().take(MAX_TERM_CHARS).collect()),
            Run::Cjk if chars.len() == 1 => out.push(chars[0].to_string()),
            Run::Cjk => out.extend(chars.windows(2).map(|w| w.iter().collect::<String>())),
        }
    }
    out
}

/// Term counts of a document: the title counts three times, tags twice, the text once.
pub fn weighted_terms(title: &str, tags: &[String], text: &str, max_terms: usize) -> Vec<(String, u16)> {
    let mut tf: BTreeMap<String, u16> = BTreeMap::new();
    for (s, w) in [(title, 3u16), (&tags.join(" ")[..], 2), (text, 1)] {
        for t in terms(s) {
            let e = tf.entry(t).or_default();
            *e = e.saturating_add(w);
        }
    }
    let mut v: Vec<(String, u16)> = tf.into_iter().collect();
    if v.len() > max_terms {
        v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        v.truncate(max_terms);
    }
    v
}

/// A query: the terms that must all match, and whether the last one may be a
/// prefix (a word still being typed).
pub fn query_terms(q: &str) -> (Vec<String>, bool) {
    let rs = runs(q);
    let last_is_word = rs.last().is_some_and(|(k, _)| *k == Run::Word);
    let typing = last_is_word && !q.ends_with(|c: char| c.is_whitespace());
    let mut t = terms(q);
    t.dedup();
    let mut seen = std::collections::BTreeSet::new();
    t.retain(|x| seen.insert(x.clone()));
    (t.into_iter().take(12).collect(), typing)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_words_and_cjk() {
        assert_eq!(terms("Road-Bike 56cm!"), vec!["road", "bike", "56cm"]);
        assert_eq!(terms("二手自行车"), vec!["二手", "手自", "自行", "行车"]);
        assert_eq!(terms("车 Café"), vec!["车", "café"]);
        assert_eq!(terms("ICP的dapp"), vec!["icp", "的", "dapp"]);
    }

    #[test]
    fn weighs_title_tags_and_text() {
        let w = weighted_terms("Bike", &["sports".into()], "bike for sale", 100);
        assert_eq!(w.iter().find(|(t, _)| t == "bike").unwrap().1, 4);
        assert_eq!(w.iter().find(|(t, _)| t == "sports").unwrap().1, 2);
        assert_eq!(weighted_terms("a b c d", &[], "", 2).len(), 2);
    }

    #[test]
    fn query_knows_when_the_last_word_is_being_typed() {
        assert_eq!(query_terms("road bi"), (vec!["road".to_string(), "bi".to_string()], true));
        assert_eq!(query_terms("road bike "), (vec!["road".to_string(), "bike".to_string()], false));
        assert_eq!(query_terms("自行车").1, false);
    }
}
