# The BDA Team Web

This repository contains the source of the [personal web page of the BDA team](https://the-bda.team/). To edit the data, see the [facilities](https://the-bda.team/facilities).

## Local Development

This repository uses automated checking to ensure that the json files follow the respectiv schemata. To automatically run the same checks used on GitHub after an commit before you commit them locally, install the [pre-commit](https://pre-commit.ci/) hooks:

```
# requires pre-commit installed
pre-commit install
```

To view the generated web pages locally, run

```
# requires bundle (ruby) installed
bundle exec jekyll serve
```

