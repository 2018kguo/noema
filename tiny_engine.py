#!/usr/bin/env python3
"""A deliberately small, standard-library causal transformer inference workshop.

No training or model download. Random weights test mechanics, not language quality.
One attention head, one block, learned positions, residuals and a tanh MLP.
The scalar implementation is an oracle, not a production performance design.
"""
import argparse
import inspect
import math
import random
import time
from dataclasses import dataclass, field


def pairs(a, b):
    if len(a) != len(b):
        raise ValueError('Mismatched dimensions')
    return zip(a, b)


def dot(a, b):
    return sum(x * y for x, y in pairs(a, b))


def matvec(matrix, vector):
    """Stored as [output,input], like torch.nn.Linear.weight."""
    return [dot(row, vector) for row in matrix]


def add(a, b):
    return [x + y for x, y in pairs(a, b)]


def softmax(values):
    shifted = [math.exp(x - max(values)) for x in values]
    total = sum(shifted)
    return [x / total for x in shifted]


@dataclass
class Cache:
    keys: list = field(default_factory=list)
    values: list = field(default_factory=list)


class TinyEngine:
    def __init__(self, seed=7, width=12, vocab=16, max_context=128):
        self.width, self.vocab, self.max_context = width, vocab, max_context
        rng = random.Random(seed)

        def matrix(rows, cols):
            return [[rng.uniform(-0.4, 0.4) for _ in range(cols)] for _ in range(rows)]

        self.embed = matrix(vocab, width)
        self.positions = matrix(max_context, width)
        self.wq, self.wk, self.wv = [matrix(width, width) for _ in range(3)]
        self.wo = matrix(width, width)
        self.up, self.down = matrix(width * 2, width), matrix(width, width * 2)
        self.head = matrix(vocab, width)

    def input_vector(self, token, position):
        if not 0 <= token < self.vocab:
            raise ValueError('Token outside vocabulary')
        if position >= self.max_context:
            raise ValueError('Maximum context reached; this model does not silently truncate')
        return add(self.embed[token], self.positions[position])

    def attention_weights(self, query, keys):
        scores = [dot(query, key) / math.sqrt(self.width) for key in keys]
        return softmax(scores)

    def attention(self, query, keys, values):
        weights = self.attention_weights(query, keys)
        return [sum(w * value[j] for w, value in pairs(weights, values))
                for j in range(self.width)]

    def finish_block(self, x, attention_output):
        residual = add(x, matvec(self.wo, attention_output))
        hidden = [math.tanh(v) for v in matvec(self.up, residual)]
        return add(residual, matvec(self.down, hidden))

    def output_logits(self, hidden, adapter=None):
        logits = matvec(self.head, hidden)
        if adapter:
            a, b, scale = adapter
            logits = add(logits, [scale * v for v in matvec(b, matvec(a, hidden))])
        return logits

    def full_logits(self, tokens, adapter=None):
        """Reference: recompute every position and apply causal prefix visibility."""
        if not tokens:
            raise ValueError('A nonempty prefix is required')
        xs = [self.input_vector(tok, i) for i, tok in enumerate(tokens)]
        qs = [matvec(self.wq, x) for x in xs]
        ks = [matvec(self.wk, x) for x in xs]
        vs = [matvec(self.wv, x) for x in xs]
        outputs = []
        for i, (x, q) in enumerate(pairs(xs, qs)):
            attended = self.attention(q, ks[:i + 1], vs[:i + 1])
            outputs.append(self.output_logits(self.finish_block(x, attended), adapter))
        return outputs

    def cached_step(self, token, cache, adapter=None, broken_offset=False):
        x = self.input_vector(token, len(cache.keys))
        q, k, v = [matvec(weight, x) for weight in (self.wq, self.wk, self.wv)]
        cache.keys.append(k)
        cache.values.append(v)
        # Exercise: both lengths still match, but dropping position 0 changes attention.
        start = 1 if broken_offset and len(cache.keys) > 1 else 0
        attended = self.attention(q, cache.keys[start:], cache.values[start:])
        return self.output_logits(self.finish_block(x, attended), adapter)

    def prefill(self, tokens, cache, adapter=None):
        if not tokens:
            raise ValueError('A nonempty prompt is required')
        # Sequential for clarity. Production prefill vectorizes known prompt positions.
        for token in tokens:
            logits = self.cached_step(token, cache, adapter)
        return logits

    def generate(self, prompt, count, use_cache=True):
        if count < 0:
            raise ValueError('count must be nonnegative')
        if not count:
            return []
        tokens = list(prompt)
        cache = Cache()
        logits = self.prefill(tokens, cache) if use_cache else self.full_logits(tokens)[-1]
        generated = []
        for step in range(count):
            token = max(range(self.vocab), key=logits.__getitem__)
            generated.append(token)
            tokens.append(token)
            if step + 1 < count:
                logits = (self.cached_step(token, cache) if use_cache
                          else self.full_logits(tokens)[-1])
        return generated


def close(a, b, tolerance=1e-10):
    error = max(abs(x - y) for x, y in pairs(a, b))
    if error > tolerance:
        raise AssertionError(f'max logit error {error:.6g} exceeds {tolerance:g}')


def lesson_experiment(case):
    """Run one fixed lesson case; caller data never becomes code or model input."""
    if case == 'reference-checks':
        return reference_checks()
    if case not in ('baseline', 'broken', 'repaired'):
        raise ValueError('Choose reference-checks, baseline, broken, or repaired.')
    engine, cache = TinyEngine(seed=7), Cache()
    prompt, tolerance, rows = [1, 4, 2, 8], 1e-10, []
    for index, token in enumerate(prompt):
        actual = engine.cached_step(token, cache, broken_offset=case == 'broken')
        reference = engine.full_logits(prompt[:index + 1])[-1]
        error = max(abs(a - b) for a, b in pairs(actual, reference))
        start = 1 if case == 'broken' and len(cache.keys) > 1 else 0
        query = matvec(engine.wq, engine.input_vector(token, index))
        visible = list(range(start, len(cache.keys)))
        weights = engine.attention_weights(query, cache.keys[start:])
        rows.append({'prefix_length': index + 1, 'max_error': error,
                     'matches': error <= tolerance, 'token_id': token,
                     'cache_length': len(cache.keys), 'visible_positions': visible,
                     'weights': weights,
                     'reference_weights': engine.attention_weights(query, cache.keys),
                     'positions': [{'position': j, 'token_id': prompt[j],
                                    'value_preview': value[:3]}
                                   for j, value in enumerate(cache.values)],
                     'attention_preview': engine.attention(query, cache.keys[start:], cache.values[start:])[:3],
                     'reference_logits': reference, 'actual_logits': actual})
    first = next((row['prefix_length'] for row in rows if not row['matches']), None)
    return {'case': case, 'prompt_ids': prompt, 'tolerance': tolerance,
            'rows': rows, 'first_divergence': first, 'matches': first is None}


def reference_checks():
    """The same executable comparisons used by the browser and command line."""
    counts = {'prefixes': 0, 'generation': 0, 'isolation': 0, 'adapter': 0, 'boundary': 0}
    for seed in (0, 7, 19):
        engine = TinyEngine(seed)
        for length in (1, 2, 7, 16, 33):
            prompt = [(i * 7 + 2) % engine.vocab for i in range(length)]
            cache = Cache()
            for i, token in enumerate(prompt):
                close(engine.cached_step(token, cache), engine.full_logits(prompt[:i + 1])[-1])
                counts['prefixes'] += 1
            assert engine.generate(prompt, 6) == engine.generate(prompt, 6, use_cache=False)
            counts['generation'] += 1
        # Interleave independent request states: shared-cache leaks cannot hide here.
        left, right = Cache(), Cache()
        for i, (a, b) in enumerate(pairs([1, 2, 3, 4], [9, 8, 7, 6])):
            close(engine.cached_step(a, left), engine.full_logits([1, 2, 3, 4][:i + 1])[-1])
            close(engine.cached_step(b, right), engine.full_logits([9, 8, 7, 6][:i + 1])[-1])
            counts['isolation'] += 2
    engine = TinyEngine()
    a = [[0.01 * (i + j + 1) for j in range(engine.width)] for i in range(2)]
    b = [[0.02 * (i - j) for j in range(2)] for i in range(engine.vocab)]
    adapter = (a, b, 0.5)
    explicit = engine.full_logits([1, 3, 4], adapter)[-1]
    engine.head = [[w + adapter[2] * sum(b[i][r] * a[r][j] for r in range(2))
                    for j, w in enumerate(row)] for i, row in enumerate(engine.head)]
    close(explicit, engine.full_logits([1, 3, 4])[-1])
    counts['adapter'] += 1
    boundary = TinyEngine(max_context=2)
    cache = Cache()
    boundary.prefill([1, 2], cache)
    try:
        boundary.cached_step(3, cache)
    except ValueError:
        assert len(cache.keys) == 2
        counts['boundary'] += 1
    else:
        raise AssertionError('Context limit was not enforced')
    descriptions = {
        'prefixes': ('Cached scores match the full prefix',
                     'Compared next-token scores after every position, over three random seeds and five prefix lengths.'),
        'generation': ('Generated token sequences match',
                       'Compared six-token greedy continuations from cached and full-prefix execution.'),
        'isolation': ('Requests keep separate working state',
                      'Interleaved two requests with different token IDs and compared each against its own reference.'),
        'adapter': ('The small weight update survives merging',
                    'Compared an explicit constructed low-rank output-head update with the same update merged into the weights.'),
        'boundary': ('The context limit is enforced',
                     'Checked that an over-limit request is rejected without appending another cache entry.')}
    return {'case': 'reference-checks', 'checks': sum(counts.values()),
            'groups': [{'id': key, 'title': descriptions[key][0], 'description': descriptions[key][1],
                        'checks': count, 'status': 'passed'} for key, count in counts.items()]}


def workshop_sources():
    """Expose only the lesson's fixed numerical routines, never a requested path."""
    names = ('attention', 'attention_weights', 'full_logits', 'cached_step', 'input_vector',
             'finish_block', 'output_logits', 'generate')
    return {name: inspect.getsource(getattr(TinyEngine, name)) for name in names}


def run_tests():
    report = reference_checks()
    print(f'PASS: {report["checks"]} comparisons/checks; cached/full prefixes, generation, request isolation, LoRA merge and capacity boundary.')
    return report


def exercise(name):
    if name == 'cache-offset':
        engine, cache = TinyEngine(), Cache()
        prompt = [1, 4, 2, 8]
        for i, token in enumerate(prompt):
            actual = engine.cached_step(token, cache, broken_offset=True)
            try:
                close(actual, engine.full_logits(prompt[:i + 1])[-1])
            except AssertionError as error:
                print(f'Expected bug detected at prefix length {i + 1}: {error}')
                print('Explain what information was lost, repair the cache read, then rerun test.')
                return
        raise AssertionError('The exercise failed to detect its deliberate bug')
    print('1. Read full_logits and cached_step. Draw shapes and cache ownership.')
    print('2. Predict cache-offset failure, then run: python3 tiny_engine.py exercise cache-offset')
    print('3. Add continuous admission with two active slots and per-request output limits.')
    print('   Oracle: every output equals independent generate, including slot reuse and early finish.')
    print('4. Add batched or vectorized operations. Keep the scalar reference; compare logits.')
    print('5. Add paged storage. Check lengths page_size-1, page_size, page_size+1 and reuse.')
    print('6. Move to a real compatible checkpoint. Check tokenizer, positions, adapters and task quality.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['test', 'demo', 'bench', 'exercise'])
    parser.add_argument('exercise_name', nargs='?', default='')
    args = parser.parse_args()
    if args.command == 'test':
        run_tests()
    elif args.command == 'exercise':
        exercise(args.exercise_name)
    elif args.command == 'demo':
        engine, cache = TinyEngine(), Cache()
        prompt = [1, 2, 3]
        logits = engine.prefill(prompt, cache)
        print('Random-weight numerical demo, not trained language output. Prompt IDs:', prompt)
        for step in range(5):
            token = max(range(engine.vocab), key=logits.__getitem__)
            print(f'output {step}: token={token}; cached_positions={len(cache.keys)}')
            logits = engine.cached_step(token, cache)
    else:
        engine = TinyEngine()
        prompt = [i % engine.vocab for i in range(24)]
        for use_cache in (False, True):
            engine.generate(prompt, 4, use_cache)
            started = time.perf_counter()
            for _ in range(3):
                engine.generate(prompt, 12, use_cache)
            elapsed = time.perf_counter() - started
            print(f'cached={use_cache}: {elapsed / 3:.6f} seconds/generation; prompt=24 output=12, scalar CPU')
        print('Local illustration only. Not a GPU benchmark or a serving latency estimate.')


if __name__ == '__main__':
    main()
