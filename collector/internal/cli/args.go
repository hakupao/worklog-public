package cli

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/hakupao/worklog/collector/internal/py/pystr"
	"github.com/hakupao/worklog/collector/internal/py/pytime"
	"github.com/hakupao/worklog/collector/internal/rt"
)

// The argument parser follows click (which Typer runs on), spec §4.1: options may come before or
// after the positionals, "--" ends the options, "--opt=value" and "--opt value" are both accepted,
// and an option that takes a value takes the next token whatever it looks like ("--hours -1").
// Usage errors exit 2. Their wording is Go's own (spec §6 D8); only the exit code is the contract.

type kind int

const (
	flag  kind = iota // --all
	value             // --project P (the last one given wins)
	multi             // --deliverable P, repeatable
)

type option struct {
	names []string // the first is the canonical name; the rest are aliases (--files-only)
	kind  kind
	meta  string // value placeholder in the help
	help  string
}

// command is one entry of the command table: a leaf with arguments and options, or a group
// (plan) with subcommands.
type command struct {
	name string
	args []string // positional names, upper case as click's metavars
	opts []option
	help string
	sub  []*command
	run  func(env *rt.Env, p *parsed) int
}

// parsed is a command line after parsing: positionals, option values by canonical name.
type parsed struct {
	args  []string
	vals  map[string][]string
	flags map[string]bool
}

func (p *parsed) has(name string) bool { _, ok := p.vals[name]; return ok }

// last is the value of a single-value option and whether it was given.
func (p *parsed) last(name string) (string, bool) {
	v := p.vals[name]
	if len(v) == 0 {
		return "", false
	}
	return v[len(v)-1], true
}

// usageError is a click UsageError: the command path for the usage line, and the message.
type usageError struct {
	path string
	msg  string
}

func (c *command) option(name string) (*option, bool) {
	for i := range c.opts {
		for _, n := range c.opts[i].names {
			if n == name {
				return &c.opts[i], true
			}
		}
	}
	return nil, false
}

// parse splits argv for a leaf command. help reports --help (eager: it wins over every error found
// after the tokens are read, as in click, but not over an unknown option or a missing value).
func (c *command) parse(path string, argv []string) (p *parsed, help bool, err *usageError) {
	p = &parsed{vals: map[string][]string{}, flags: map[string]bool{}}
	fail := func(format string, a ...any) (*parsed, bool, *usageError) {
		return nil, false, &usageError{path, fmt.Sprintf(format, a...)}
	}
	for i := 0; i < len(argv); i++ {
		tok := argv[i]
		switch {
		case tok == "--":
			p.args = append(p.args, argv[i+1:]...)
			i = len(argv)
		case strings.HasPrefix(tok, "--") && len(tok) > 2:
			name, val, hasVal := strings.Cut(tok, "=")
			if name == "--help" {
				if hasVal {
					return fail("Option '--help' does not take a value.")
				}
				help = true
				continue
			}
			o, ok := c.option(name)
			if !ok {
				return fail("No such option: %s", name)
			}
			canon := o.names[0]
			if o.kind == flag {
				if hasVal {
					return fail("Option '%s' does not take a value.", name)
				}
				p.flags[canon] = true
				continue
			}
			if !hasVal {
				if i+1 >= len(argv) {
					return fail("Option '%s' requires an argument.", name)
				}
				i++
				val = argv[i]
			}
			p.vals[canon] = append(p.vals[canon], val)
		case strings.HasPrefix(tok, "-") && len(tok) > 1:
			return fail("No such option: %s", tok)
		default:
			p.args = append(p.args, tok)
		}
	}
	if help {
		return p, true, nil
	}
	if len(p.args) < len(c.args) {
		return fail("Missing argument '%s'.", c.args[len(p.args)])
	}
	if extra := p.args[len(c.args):]; len(extra) > 0 {
		s := ""
		if len(extra) > 1 {
			s = "s"
		}
		return fail("Got unexpected extra argument%s (%s)", s, strings.Join(extra, " "))
	}
	return p, false, nil
}

// pyInt is click's INT conversion, int(s): surrounding whitespace, a sign, and underscores between
// digits. Only ASCII digits are taken (Python also takes other Unicode decimals).
func pyInt(s string) (int, bool) {
	t := pystr.Strip(s)
	sign := ""
	if t != "" && (t[0] == '+' || t[0] == '-') {
		sign, t = t[:1], t[1:]
	}
	digits, ok := underscores(t)
	if !ok {
		return 0, false
	}
	n, err := strconv.Atoi(sign + digits)
	return n, err == nil
}

// underscores removes the underscores of a digit run, refusing one at either end or doubled.
func underscores(t string) (string, bool) {
	if t == "" || t[0] == '_' || t[len(t)-1] == '_' || strings.Contains(t, "__") {
		return "", false
	}
	out := strings.ReplaceAll(t, "_", "")
	for _, r := range out {
		if r < '0' || r > '9' {
			return "", false
		}
	}
	return out, true
}

// pyFloat is click's FLOAT conversion, float(s): whitespace, a sign, digits with underscores between
// them, a fraction, an exponent, or inf / infinity / nan in any case. No hex.
func pyFloat(s string) (float64, bool) {
	t := pystr.Strip(s)
	body := strings.TrimLeft(t, "+-")
	if len(t)-len(body) > 1 {
		return 0, false
	}
	switch strings.ToLower(body) {
	case "inf", "infinity":
		if strings.HasPrefix(t, "-") {
			return math.Inf(-1), true
		}
		return math.Inf(1), true
	case "nan":
		return math.NaN(), true
	}
	// mantissa [e[+-]exponent]; every digit run may hold single underscores between digits.
	mant, exp, hasExp := strings.Cut(strings.ToLower(body), "e")
	intPart, frac, hasDot := strings.Cut(mant, ".")
	clean := func(run string, may bool) (string, bool) {
		if run == "" {
			return "", may
		}
		return underscores(run)
	}
	ip, ok1 := clean(intPart, hasDot && frac != "")
	fp, ok2 := clean(frac, true)
	if !ok1 || !ok2 || (ip == "" && fp == "") {
		return 0, false
	}
	num := ip
	if hasDot {
		num += "." + fp
	}
	if hasExp {
		esign := ""
		if exp != "" && (exp[0] == '+' || exp[0] == '-') {
			esign, exp = exp[:1], exp[1:]
		}
		ed, ok := underscores(exp)
		if !ok {
			return 0, false
		}
		num += "e" + esign + ed
	}
	if t[0] == '-' {
		num = "-" + num
	}
	f, err := strconv.ParseFloat(num, 64)
	if err != nil {
		// Overflow: Python's float() returns inf there too.
		if ne, ok := err.(*strconv.NumError); ok && ne.Err == strconv.ErrRange {
			return f, true
		}
		return 0, false
	}
	return f, true
}

// intOpt converts an INT option, or reports click's usage error.
func intOpt(path, name, s string) (int, *usageError) {
	n, ok := pyInt(s)
	if !ok {
		return 0, &usageError{path, fmt.Sprintf("Invalid value for '%s': '%s' is not a valid integer.", name, s)}
	}
	return n, nil
}

// minZeroFloat converts a FloatRange(min=0) option. NaN passes, as it does in click (nan < 0 is
// false), and so does -0.0.
func minZeroFloat(path, name, s string) (float64, *usageError) {
	f, ok := pyFloat(s)
	if !ok {
		return 0, &usageError{path, fmt.Sprintf("Invalid value for '%s': '%s' is not a valid float.", name, s)}
	}
	if f < 0 {
		return 0, &usageError{path, fmt.Sprintf("Invalid value for '%s': %s is not in the range x>=0.", name, pytime.FloatRepr(f))}
	}
	return f, nil
}
