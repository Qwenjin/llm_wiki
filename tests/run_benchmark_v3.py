#!/usr/bin/env python3
"""
Benchmark V3: Token + BM25 + Vector + Graph, 4-lane RRF

Phase 3: Add embedding-based semantic search via local LM Studio API
Model: text-embedding-qwen3-embedding-0.6b (1024 dim)

Compare against V1 (baseline) and V2 (BM25 + Intent + RRF).
"""

import json
import re
import math
import time
import urllib.request
from pathlib import Path
from collections import defaultdict, Counter

BASE = Path(__file__).parent / "fixtures" / "wiki"
QUERIES_FILE = Path(__file__).parent / "fixtures" / "queries.json"
EMBED_CACHE_FILE = Path(__file__).parent / "fixtures" / "embed_cache.json"

EMBED_API = "http://127.0.0.1:1234/v1/embeddings"
EMBED_MODEL = "text-embedding-qwen3-embedding-0.6b"

# ── Embedding helpers ──────────────────────────────────────────────────────

embed_cache = {}

def load_embed_cache():
    global embed_cache
    if EMBED_CACHE_FILE.exists():
        embed_cache = json.loads(EMBED_CACHE_FILE.read_text(encoding="utf-8"))
        print(f"  Loaded {len(embed_cache)} cached embeddings")

def save_embed_cache():
    EMBED_CACHE_FILE.write_text(json.dumps(embed_cache), encoding="utf-8")

def get_embedding(text, cache_key=None):
    """Get embedding from local API, with caching."""
    key = cache_key or text[:200]
    if key in embed_cache:
        return embed_cache[key]

    # Truncate to avoid token limits
    text = text[:2000]

    payload = json.dumps({"model": EMBED_MODEL, "input": text}).encode("utf-8")
    req = urllib.request.Request(EMBED_API, data=payload, headers={"Content-Type": "application/json"})

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
            emb = data["data"][0]["embedding"]
            embed_cache[key] = emb
            return emb
    except Exception as e:
        print(f"  Embedding API error: {e}")
        return None

def cosine_similarity(a, b):
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)

# ── Load wiki pages ────────────────────────────────────────────────────────

def load_wiki():
    pages = {}
    for md in BASE.rglob("*.md"):
        rel = md.relative_to(BASE)
        if rel.name in ("index.md", "overview.md", "purpose.md", "schema.md", "log.md"):
            continue
        page_id = rel.with_suffix("").name
        content = md.read_text(encoding="utf-8")
        fm_match = re.match(r"^---\n(.*?)\n---", content, re.DOTALL)
        fm = fm_match.group(1) if fm_match else ""
        title_match = re.search(r'^title:\s*"?(.+?)"?\s*$', fm, re.MULTILINE)
        type_match = re.search(r'^type:\s*(\w+)', fm, re.MULTILINE)
        sources_match = re.search(r'^sources:\s*\[([^\]]*)\]', fm, re.MULTILINE)
        title = title_match.group(1).strip() if title_match else page_id
        page_type = type_match.group(1).strip() if type_match else "other"
        sources = []
        if sources_match:
            sources = [s.strip().strip('"').strip("'") for s in sources_match.group(1).split(",") if s.strip()]
        links = re.findall(r'\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]', content)
        pages[page_id] = {
            "title": title, "type": page_type, "content": content,
            "sources": sources, "links": [l.strip() for l in links], "path": str(rel),
        }
    return pages

# ── Tokenized Search ───────────────────────────────────────────────────────

STOP_WORDS = {
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
    "into", "through", "during", "before", "after", "above", "below",
    "between", "under", "about", "against", "and", "but", "or", "nor",
    "not", "so", "yet", "both", "either", "neither", "each", "every",
    "all", "any", "few", "more", "most", "other", "some", "such", "no",
    "only", "own", "same", "than", "too", "very", "just", "because",
    "if", "when", "where", "how", "what", "which", "who", "whom",
    "this", "that", "these", "those", "it", "its", "he", "she", "they",
    "them", "we", "us", "my", "your", "his", "her", "our", "their",
    "的", "是", "在", "了", "和", "与", "或", "也", "都", "就",
    "不", "有", "这", "那", "个", "中", "上", "下", "大", "小",
}

def is_cjk(ch):
    cp = ord(ch)
    return (0x4E00 <= cp <= 0x9FFF or 0x3400 <= cp <= 0x4DBF or
            0x2B820 <= cp <= 0x2CEAF or 0xF900 <= cp <= 0xFAFF)

def tokenize(text):
    text = text.lower()
    tokens = []
    parts = re.split(r'[^\w\u4e00-\u9fff\u3400-\u4dbf]+', text)
    for part in parts:
        if not part:
            continue
        has_cjk = any(is_cjk(ch) for ch in part)
        if has_cjk:
            cjk_chars = [ch for ch in part if is_cjk(ch)]
            for i in range(len(cjk_chars)):
                if i + 1 < len(cjk_chars):
                    tokens.append(cjk_chars[i] + cjk_chars[i + 1])
                tokens.append(cjk_chars[i])
            non_cjk = re.findall(r'[a-z0-9]+', part)
            for word in non_cjk:
                if word not in STOP_WORDS and len(word) > 1:
                    tokens.append(word)
        else:
            if part not in STOP_WORDS and len(part) > 1:
                tokens.append(part)
    return tokens

def search_tokenized(query, pages, top_k=20):
    query_tokens = tokenize(query)
    if not query_tokens:
        return []
    scored = []
    for page_id, page in pages.items():
        content_lower = page["content"].lower()
        title_lower = page["title"].lower()
        score = 0
        for token in query_tokens:
            if token in content_lower:
                score += 1
            if token in title_lower:
                score += 10
        if score > 0:
            scored.append((page_id, score))
    scored.sort(key=lambda x: -x[1])
    return scored[:top_k]

# ── BM25 ───────────────────────────────────────────────────────────────────

class BM25Index:
    def __init__(self, k1=1.5, b=0.75, title_boost=3.0):
        self.k1, self.b, self.title_boost = k1, b, title_boost
        self.doc_count = 0
        self.avg_dl = 0.0
        self.doc_lens, self.doc_freqs, self.tf, self.title_tf = {}, {}, {}, {}

    def index(self, pages):
        self.doc_count = len(pages)
        total_len = 0
        for pid, page in pages.items():
            ct = tokenize(page["content"])
            tt = tokenize(page["title"])
            self.doc_lens[pid] = len(ct)
            total_len += len(ct)
            self.tf[pid] = Counter(ct)
            self.title_tf[pid] = Counter(tt)
            for token in set(ct) | set(tt):
                self.doc_freqs[token] = self.doc_freqs.get(token, 0) + 1
        self.avg_dl = total_len / self.doc_count if self.doc_count > 0 else 1.0

    def search(self, query, top_k=20):
        query_tokens = tokenize(query)
        if not query_tokens:
            return []
        scores = {}
        for pid in self.tf:
            score = 0.0
            dl = self.doc_lens[pid]
            for token in query_tokens:
                if token not in self.doc_freqs:
                    continue
                n = self.doc_freqs[token]
                idf = math.log((self.doc_count - n + 0.5) / (n + 0.5) + 1.0)
                tf = self.tf[pid].get(token, 0)
                tf_norm = (tf * (self.k1 + 1)) / (tf + self.k1 * (1 - self.b + self.b * dl / self.avg_dl))
                score += idf * tf_norm
                if self.title_tf[pid].get(token, 0) > 0:
                    score += idf * self.title_boost
            if score > 0:
                scores[pid] = score
        return sorted(scores.items(), key=lambda x: -x[1])[:top_k]

# ── Vector Search ──────────────────────────────────────────────────────────

def build_page_embeddings(pages):
    """Embed all pages (title + first 500 chars of content)."""
    embeddings = {}
    total = len(pages)
    for i, (pid, page) in enumerate(pages.items()):
        # Use title + beginning of content for embedding
        text = f"{page['title']}\n{page['content'][:500]}"
        emb = get_embedding(text, cache_key=f"page:{pid}")
        if emb:
            embeddings[pid] = emb
        if (i + 1) % 20 == 0:
            print(f"  Embedded {i+1}/{total} pages...")
            save_embed_cache()

    save_embed_cache()
    return embeddings

def search_vector(query, page_embeddings, top_k=20):
    """Semantic search via cosine similarity."""
    query_emb = get_embedding(query, cache_key=f"query:{query[:100]}")
    if not query_emb:
        return []

    scored = []
    for pid, page_emb in page_embeddings.items():
        sim = cosine_similarity(query_emb, page_emb)
        if sim > 0:
            scored.append((pid, sim))

    scored.sort(key=lambda x: -x[1])
    return scored[:top_k]

# ── Graph Expansion ────────────────────────────────────────────────────────

TYPE_AFFINITY = {
    "entity": {"concept": 1.2, "entity": 0.8, "source": 1.0, "synthesis": 1.0, "comparison": 0.8},
    "concept": {"entity": 1.2, "concept": 0.8, "source": 1.0, "synthesis": 1.2, "comparison": 1.0},
    "source": {"entity": 1.0, "concept": 1.0, "source": 0.5, "synthesis": 1.0, "comparison": 0.8},
    "synthesis": {"concept": 1.2, "entity": 1.0, "source": 1.0, "synthesis": 0.8, "comparison": 1.0},
    "comparison": {"concept": 1.0, "entity": 0.8, "source": 0.8, "synthesis": 1.0, "comparison": 0.5},
}
REL_WEIGHTS = {"direct_link": 3.0, "source_overlap": 4.0, "common_neighbor": 1.5, "type_affinity": 1.0}

def build_graph(pages):
    out_links = {}
    in_links = defaultdict(set)
    for pid, page in pages.items():
        resolved = set()
        for link in page["links"]:
            target = link.lower().replace(" ", "-")
            if target in pages and target != pid:
                resolved.add(target)
        out_links[pid] = resolved
        for target in resolved:
            in_links[target].add(pid)
    return out_links, dict(in_links)

def calc_relevance(a_id, b_id, pages, out_links, in_links):
    a, b = pages[a_id], pages[b_id]
    a_out, b_out = out_links.get(a_id, set()), out_links.get(b_id, set())
    a_in, b_in = in_links.get(a_id, set()), in_links.get(b_id, set())
    direct = ((1 if b_id in a_out else 0) + (1 if a_id in b_out else 0)) * REL_WEIGHTS["direct_link"]
    shared_src = len(set(a["sources"]) & set(b["sources"]))
    source_overlap = shared_src * REL_WEIGHTS["source_overlap"]
    a_nb, b_nb = a_out | a_in, b_out | b_in
    aa = sum(1 / math.log(max(len(out_links.get(c, set())) + len(in_links.get(c, set())), 2)) for c in a_nb & b_nb)
    common_neighbor = aa * REL_WEIGHTS["common_neighbor"]
    affinity = TYPE_AFFINITY.get(a["type"], {}).get(b["type"], 0.5)
    return direct + source_overlap + common_neighbor + affinity * REL_WEIGHTS["type_affinity"]

def graph_expand(seed_ids, pages, out_links, in_links, top_k=15):
    candidates = {}
    seed_set = set(seed_ids)
    for seed_id in seed_ids:
        if seed_id not in pages:
            continue
        neighbors_1 = (out_links.get(seed_id, set()) | in_links.get(seed_id, set())) - seed_set
        for n1 in neighbors_1:
            rel = calc_relevance(seed_id, n1, pages, out_links, in_links)
            if n1 not in candidates or candidates[n1] < rel:
                candidates[n1] = rel
            neighbors_2 = (out_links.get(n1, set()) | in_links.get(n1, set())) - seed_set - {n1}
            for n2 in neighbors_2:
                rel2 = calc_relevance(n1, n2, pages, out_links, in_links) * 0.5
                if n2 not in candidates or candidates[n2] < rel2:
                    candidates[n2] = rel2
    return sorted(candidates.items(), key=lambda x: -x[1])[:top_k]

# ── Intent Classification ──────────────────────────────────────────────────

def classify_intent(query):
    q = query.lower()
    if any(kw in q for kw in ["关系", "连接", "影响", "导致", "如何", "怎么",
                               "relationship", "connection", "connect", "influence",
                               "how did", "how does", "link between", "from", "led to", "path"]):
        return "relationship"
    tokens = tokenize(query)
    if len(tokens) <= 3 and not any(is_cjk(ch) for ch in query if len(query) < 20):
        return "exact"
    if any(kw in q for kw in ["why", "what makes", "what role", "what determines",
                               "为什么", "什么因素", "什么决定"]):
        return "exploratory"
    return "conceptual"

# ── RRF Fusion ─────────────────────────────────────────────────────────────

def rrf_fuse(lanes, weights, k=30):
    scores = defaultdict(float)
    for lane_name, results in lanes.items():
        w = weights.get(lane_name, 1.0)
        for rank, (doc_id, _score) in enumerate(results, start=1):
            scores[doc_id] += w / (k + rank)
    return sorted(scores.items(), key=lambda x: -x[1])

# ── V3 Search Pipeline ────────────────────────────────────────────────────

def search_v3(query, bm25_index, pages, page_embeddings, out_links, in_links, top_k=10):
    """
    V3 Pipeline: 4-lane retrieval + RRF
    1. Token search (high recall)
    2. BM25 (IDF ranking)
    3. Vector search (semantic similarity)
    4. Graph expansion (structural)
    """
    intent = classify_intent(query)

    # 4 lanes
    token_results = search_tokenized(query, pages, top_k=top_k * 2)
    bm25_results = bm25_index.search(query, top_k=top_k * 2)
    vector_results = search_vector(query, page_embeddings, top_k=top_k * 2)

    # Graph seeds from all three lanes
    seed_ids = list(dict.fromkeys(
        [pid for pid, _ in token_results[:3]] +
        [pid for pid, _ in bm25_results[:3]] +
        [pid for pid, _ in vector_results[:3]]
    ))
    graph_results = graph_expand(seed_ids, pages, out_links, in_links, top_k=top_k * 2)

    # Intent-adaptive 4-lane weights
    lane_weights = {
        "exact":        {"token": 1.5, "bm25": 1.3, "vector": 0.8, "graph": 0.4},
        "conceptual":   {"token": 0.8, "bm25": 0.8, "vector": 1.5, "graph": 1.0},
        "relationship": {"token": 0.5, "bm25": 0.5, "vector": 1.0, "graph": 1.8},
        "exploratory":  {"token": 0.6, "bm25": 0.6, "vector": 1.5, "graph": 1.3},
    }
    weights = lane_weights[intent]

    fused = rrf_fuse(
        {"token": token_results, "bm25": bm25_results, "vector": vector_results, "graph": graph_results},
        weights,
    )
    return [pid for pid, _ in fused[:top_k]]

# ── Evaluation ─────────────────────────────────────────────────────────────

def evaluate(results, expected, unexpected=None):
    expected_set = set(expected)
    unexpected_set = set(unexpected) if unexpected else set()
    results_set = set(results)
    found = expected_set & results_set
    recall = len(found) / len(expected_set) if expected_set else 1.0
    precision = len(found) / len(results) if results else 0.0
    mrr = 0.0
    for i, pid in enumerate(results):
        if pid in expected_set:
            mrr = 1.0 / (i + 1)
            break
    return {"recall": recall, "precision": precision, "mrr": mrr, "unexpected_hits": len(results_set & unexpected_set)}

# ── Main ───────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Loading wiki pages...")
    pages = load_wiki()
    print(f"  {len(pages)} pages loaded")

    print("Loading embedding cache...")
    load_embed_cache()

    print("Building page embeddings (this may take a while on first run)...")
    page_embeddings = build_page_embeddings(pages)
    print(f"  {len(page_embeddings)} page embeddings ready")

    print("Building BM25 index...")
    bm25 = BM25Index()
    bm25.index(pages)
    print(f"  {len(bm25.doc_freqs)} unique terms")

    print("Building graph...")
    out_links, in_links = build_graph(pages)
    print(f"  {sum(len(v) for v in out_links.values())} edges")

    print("Loading queries...")
    queries = json.loads(QUERIES_FILE.read_text(encoding="utf-8"))
    print(f"  {len(queries)} queries\n")

    print("Running V3 benchmark (Token + BM25 + Vector + Graph)...\n")

    TOP_K = 10
    level_labels = {
        1: "Direct Match", 2: "Synonym/Alternate", 3: "Cross-Domain",
        4: "Disambiguation", 5: "Implicit Association", 6: "Reasoning Chain",
        7: "Mixed Language",
    }

    level_metrics = defaultdict(lambda: {"recall": [], "precision": [], "mrr": [], "unexpected": []})
    all_metrics = {"recall": [], "precision": [], "mrr": [], "unexpected": []}

    t0 = time.time()
    for i, q in enumerate(queries):
        results = search_v3(q["query"], bm25, pages, page_embeddings, out_links, in_links, top_k=TOP_K)
        m = evaluate(results, q["expected"], q.get("unexpected"))
        level = q["level"]
        for store in [level_metrics[level], all_metrics]:
            store["recall"].append(m["recall"])
            store["precision"].append(m["precision"])
            store["mrr"].append(m["mrr"])
            store["unexpected"].append(m["unexpected_hits"])
        if (i + 1) % 100 == 0:
            elapsed = time.time() - t0
            print(f"  Processed {i+1}/500 queries ({elapsed:.1f}s)...")
            save_embed_cache()

    save_embed_cache()
    elapsed = time.time() - t0
    print(f"  Done in {elapsed:.1f}s\n")

    # Print results
    print(f"{'Level':<30} {'Recall@{}'.format(TOP_K):>10} {'Prec@{}'.format(TOP_K):>10} {'MRR':>10} {'Unexp':>8} {'Count':>7}")
    print("-" * 77)
    for level in sorted(level_metrics.keys()):
        m = level_metrics[level]
        n = len(m["recall"])
        label = f"L{level}: {level_labels.get(level, '')}"
        print(f"{label:<30} {sum(m['recall'])/n:>9.1%} {sum(m['precision'])/n:>9.1%} {sum(m['mrr'])/n:>9.3f} {sum(m['unexpected']):>7d} {n:>7d}")
    print("-" * 77)
    n_all = len(all_metrics["recall"])
    print(f"{'OVERALL':<30} {sum(all_metrics['recall'])/n_all:>9.1%} {sum(all_metrics['precision'])/n_all:>9.1%} {sum(all_metrics['mrr'])/n_all:>9.3f} {sum(all_metrics['unexpected']):>7d} {n_all:>7d}")

    # Comparison
    baseline_file = Path(__file__).parent / "fixtures" / "benchmark_results.json"
    if baseline_file.exists():
        baseline = json.loads(baseline_file.read_text(encoding="utf-8"))
        baseline_by_level = defaultdict(list)
        for b in baseline:
            baseline_by_level[b["level"]].append(b["recall"])

        print(f"\n{'':=<85}")
        print("COMPARISON: V1 (baseline) vs V2 (BM25+RRF) vs V3 (+ Vector)")
        print(f"{'':=<85}")
        print(f"{'Level':<30} {'V1':>10} {'V2':>10} {'V3':>10} {'V1→V3':>10}")
        print("-" * 72)

        # V2 results (hardcoded from previous run)
        v2_recalls = {1: 0.912, 2: 0.769, 3: 0.561, 4: 0.500, 5: 0.323, 6: 0.432, 7: 0.636}

        for level in sorted(level_metrics.keys()):
            v1 = baseline_by_level.get(level, [])
            v1_avg = sum(v1) / len(v1) if v1 else 0
            v2_avg = v2_recalls.get(level, 0)
            v3_avg = sum(level_metrics[level]["recall"]) / len(level_metrics[level]["recall"])
            delta = v3_avg - v1_avg
            arrow = "↑" if delta > 0.005 else "↓" if delta < -0.005 else "="
            label = f"L{level}: {level_labels.get(level, '')}"
            print(f"{label:<30} {v1_avg:>9.1%} {v2_avg:>9.1%} {v3_avg:>9.1%} {arrow}{abs(delta):>8.1%}")

        v1_all = [b["recall"] for b in baseline]
        v1_overall = sum(v1_all) / len(v1_all)
        v3_overall = sum(all_metrics["recall"]) / n_all
        delta = v3_overall - v1_overall
        arrow = "↑" if delta > 0.005 else "↓" if delta < -0.005 else "="
        print("-" * 72)
        print(f"{'OVERALL':<30} {v1_overall:>9.1%} {'59.9%':>10} {v3_overall:>9.1%} {arrow}{abs(delta):>8.1%}")
