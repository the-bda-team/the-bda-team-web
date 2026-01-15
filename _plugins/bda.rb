module Jekyll
  module BDAFilters
    def unique_authors(input)
      return input.map { | publication | publication["author"] }
        .flatten(1)
        .uniq
        .map { | author | author[0] + "_" + author[1] }
    end
  end
end

Liquid::Template.register_filter(Jekyll::BDAFilters)
